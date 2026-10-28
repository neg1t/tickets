import { useEffect, useMemo, useRef, useState } from 'react';
import { createEmptyDraft, type HallLayoutDraft } from '@hall-platform/domain';
import { createHallApiClient, HallApiError, mapBuyerOccurrence, minorToMajor } from '@hall-platform/api-axios';
import type { ApiHallRecord, ApiHallSummary, ApiHold, ApiOccurrence, ApiOrder, ApiPublishedVersion } from '@hall-platform/api-contracts';
import { HallEditor } from '@hall-platform/hall-editor';
import { PricingEditor, createPricingPreviewPriceMap } from '@hall-platform/pricing-editor';
import { SeatView, validateSelection, type SeatSelectionItem } from '@hall-platform/seat-view';
import type { PricingAssignmentDocument } from '@hall-platform/domain';
import {
  createPricingSaveAttempt,
  loadPricingPageData,
  mapApiPricingAssignments,
  samePricingAssignments,
  type PricingPageData,
  type PricingSaveAttempt,
} from './pricingPage.model.js';
import {
  clearApiPricingRecovery,
  createApiPricingRecoveryRecord,
  readApiPricingRecovery,
  resolveApiPricingRecovery,
  saveApiPricingRecovery,
} from './apiPricingRecovery.js';
import './api-studio.css';

type Client = ReturnType<typeof createHallApiClient>;
type Page = 'catalog' | 'editor' | 'buyer' | 'pricing';

function errorMessage(error: unknown): string {
  if (error instanceof HallApiError) {
    if (error.code === 'revision_conflict') return 'Данные изменились на сервере. Черновик цен сохранён локально; сверьте актуальное состояние перед следующим сохранением.';
    if (error.code === 'availability_conflict' || error.code === 'hold_expired')
      return 'Места изменились или удержание истекло. Обновите мероприятие и выберите снова.';
    if (error.code === 'pricing_catalog_conflict') return 'Каталог цен изменился. Проверьте актуальные назначения перед сохранением.';
    if (error.code === 'layout_version_conflict') return 'Назначения относятся к другой опубликованной версии схемы.';
    if (error.code === 'invalid_pricing_assignment') return 'Сервер отклонил назначение цен. Проверьте указанные объекты.';
    const issues = error.issues?.map(({ targetId, message }) => `${targetId ? `${targetId}: ` : ''}${message}`);
    return issues?.length ? `${error.message} ${issues.join(' ')}` : error.message;
  }
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(
    minorToMajor({ amountMinor, currency }),
  );
}

function activeHold(hold: ApiHold | null): ApiHold | null {
  return hold && Date.parse(hold.expiresAt) > Date.now() ? hold : null;
}

function sameTotal(
  first: Readonly<{ amountMinor: number; currency: string }> | null,
  second: Readonly<{ amountMinor: number; currency: string }>,
): boolean {
  return Boolean(first && first.amountMinor === second.amountMinor && first.currency === second.currency);
}

function displayedTotal(
  occurrence: ApiOccurrence,
  selection: readonly SeatSelectionItem[],
): Readonly<{ amountMinor: number; currency: string }> | null {
  const buyer = mapBuyerOccurrence(occurrence);
  const selectionAvailability = {
    seats: Object.fromEntries(selection.flatMap((item) => item.kind === 'seat' ? [[item.seatId, 'available' as const]] : [])),
    zones: Object.fromEntries(selection.flatMap((item) => item.kind === 'generalAdmission'
      ? [[item.zoneId, { available: item.quantity, maxPerOrder: item.quantity }]]
      : [])),
  };
  const result = validateSelection({
    layout: buyer.layout,
    selection,
    availability: selectionAvailability,
    prices: buyer.prices,
  });
  return result.valid && result.total
    ? { amountMinor: result.total.minorUnits, currency: result.total.currency }
    : null;
}

function isDefinitivePricingFailure(error: unknown): boolean {
  if (!(error instanceof HallApiError)) return false;
  return [
    'revision_conflict', 'pricing_catalog_conflict', 'layout_version_conflict',
    'invalid_pricing_assignment', 'validation_failed', 'unauthorized',
    'forbidden', 'not_found', 'invalid_request', 'idempotency_conflict',
  ].includes(error.code);
}

export default function ApiStudioPage() {
  const clientRef = useRef<Client | null>(null);
  const tokenRef = useRef('');
  const draftKeysRef = useRef(new WeakMap<HallLayoutDraft, { save?: string; publish?: string; publishWarnings?: string }>());
  const bookingKeysRef = useRef(new Map<string, string>());
  const pendingOrderRef = useRef<ApiOrder | null>(null);
  const pricingLoadRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const pricingLoadIdRef = useRef(0);
  const pricingAttemptRef = useRef<PricingSaveAttempt | null>(null);
  const shownTotalRef = useRef<Readonly<{ amountMinor: number; currency: string }> | null>(null);
  const [token, setToken] = useState('');
  const [page, setPage] = useState<Page>('catalog');
  const [halls, setHalls] = useState<ApiHallSummary[]>([]);
  const [occurrences, setOccurrences] = useState<ApiOccurrence[]>([]);
  const [record, setRecord] = useState<ApiHallRecord | null>(null);
  const [draft, setDraft] = useState<HallLayoutDraft | null>(null);
  const [versions, setVersions] = useState<ApiPublishedVersion[]>([]);
  const [occurrence, setOccurrence] = useState<ApiOccurrence | null>(null);
  const [selection, setSelection] = useState<SeatSelectionItem[]>([]);
  const [hold, setHold] = useState<ApiHold | null>(null);
  const [receipt, setReceipt] = useState<ApiOrder | null>(null);
  const [pricingData, setPricingData] = useState<PricingPageData | null>(null);
  const [pricingDraft, setPricingDraft] = useState<PricingAssignmentDocument | null>(null);
  const [pricingAttempt, setPricingAttempt] = useState<PricingSaveAttempt | null>(null);
  const [pricingPreviewOpen, setPricingPreviewOpen] = useState(false);
  const [pricingPreviewSelection, setPricingPreviewSelection] = useState<SeatSelectionItem[]>([]);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState('');
  const [pricingNeedsRefresh, setPricingNeedsRefresh] = useState(false);
  const [pricingBuyerTotalChanged, setPricingBuyerTotalChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const baseURL = import.meta.env.VITE_HALL_API_BASE_URL as string | undefined ?? (
    import.meta.env.DEV ? new URLSearchParams(window.location.search).get('apiBase') ?? undefined : undefined
  );

  function draftKey(value: HallLayoutDraft, kind: 'save' | 'publish' | 'publishWarnings') {
    const keys = draftKeysRef.current.get(value) ?? {};
    const key = keys[kind] ?? crypto.randomUUID();
    keys[kind] = key;
    draftKeysRef.current.set(value, keys);
    return key;
  }
  function bookingKey(id: string) {
    const key = bookingKeysRef.current.get(id) ?? crypto.randomUUID();
    bookingKeysRef.current.set(id, key);
    return key;
  }

  async function loadCatalog(client: Client) {
    const [nextHalls, nextOccurrences] = await Promise.all([
      client.listHalls(), client.listOccurrences(),
    ]);
    setHalls(nextHalls);
    setOccurrences(nextOccurrences);
  }

  useEffect(() => {
    if (!baseURL) return;
    const client = createHallApiClient({ baseURL, getToken: () => tokenRef.current || undefined });
    clientRef.current = client;
    let active = true;
    void Promise.all([client.listHalls(), client.listOccurrences()]).then(([nextHalls, nextOccurrences]) => {
      if (active) { setHalls(nextHalls); setOccurrences(nextOccurrences); }
    }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => {
      active = false;
      pricingLoadRef.current?.controller.abort();
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [baseURL]);

  useEffect(() => () => pricingLoadRef.current?.controller.abort(), []);

  useEffect(() => {
    if (!hold || !occurrence) return;
    const remaining = Date.parse(hold.expiresAt) - Date.now();
    const timer = window.setTimeout(() => {
      setHold(null);
      setPricingBuyerTotalChanged(false);
      setSelection([]);
      pendingOrderRef.current = null;
      setNotice('Удержание истекло. Обновите наличие и выберите места снова.');
      const client = clientRef.current;
      if (client) void client.getOccurrence(occurrence.id).then((next) => {
        setOccurrence(next);
        setHold(activeHold(next.ownHold));
      }).catch((cause: unknown) => setError(errorMessage(cause)));
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [hold, occurrence]);

  async function run(operation: (client: Client) => Promise<void>) {
    const client = clientRef.current;
    if (!client) { setError('Не задан VITE_HALL_API_BASE_URL'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try { await operation(client); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  const pricingDirty = Boolean(
    pricingData && pricingDraft && !samePricingAssignments(pricingDraft, pricingData.document),
  );

  function canLeavePricing(): boolean {
    if (pricingAttemptRef.current) {
      return window.confirm('Результат сохранения неизвестен. Черновик и исходный ключ запроса сохранены локально без токена и восстановятся при повторном открытии. Продолжить?');
    }
    return !pricingDirty || window.confirm('Есть несохранённые назначения цен. Локальная копия останется для восстановления. Продолжить?');
  }

  async function openPricing(id: string, options: { discardRecovery?: boolean } = {}) {
    if (page === 'pricing' && !canLeavePricing()) return;
    if (!baseURL) { setPricingError('Не задан VITE_HALL_API_BASE_URL'); return; }
    const client = clientRef.current;
    if (!client) { setError('Не задан VITE_HALL_API_BASE_URL'); return; }
    const apiBaseUrl = baseURL;
    pricingLoadRef.current?.controller.abort();
    const loadId = ++pricingLoadIdRef.current;
    const controller = new AbortController();
    pricingLoadRef.current = { id: loadId, controller };
    setBusy(false);
    setPage('pricing');
    setPricingLoading(true);
    setPricingError('');
    setPricingNeedsRefresh(false);
    setError('');
    setNotice('');
    setPricingData(null);
    setPricingDraft(null);
    setPricingAttempt(null);
    pricingAttemptRef.current = null;
    setPricingPreviewOpen(false);
    setPricingPreviewSelection([]);
    try {
      const next = await loadPricingPageData(client, id, controller.signal);
      if (pricingLoadRef.current?.id !== loadId || controller.signal.aborted) return;
      setPricingData(next);
      if (options.discardRecovery) {
        try {
          clearApiPricingRecovery(
            window.localStorage,
            apiBaseUrl,
            id,
            next.document.layoutVersionId,
          );
          setPricingDraft(next.document);
        } catch {
          setPricingDraft(next.document);
          setPricingError('Серверное состояние загружено, но локальную копию черновика не удалось удалить.');
          setPricingNeedsRefresh(true);
        }
      } else {
        const recovery = readApiPricingRecovery(
          window.localStorage,
          apiBaseUrl,
          id,
          next.document.layoutVersionId,
        );
        if (recovery.kind === 'invalid') {
          setPricingDraft(next.document);
          setPricingNeedsRefresh(true);
          setPricingError('Локальная копия цен повреждена. Серверные данные не изменены; сверьте состояние, чтобы удалить эту копию.');
        } else if (recovery.kind === 'record') {
          const resolution = resolveApiPricingRecovery(recovery.record, apiBaseUrl, next);
          if (resolution.kind === 'restore-draft') {
            setPricingDraft(resolution.document);
            setNotice('Восстановлен локальный черновик назначений цен.');
          } else if (resolution.kind === 'retry') {
            setPricingDraft(resolution.document);
            pricingAttemptRef.current = resolution.attempt;
            setPricingAttempt(resolution.attempt);
            setNotice('Восстановлена незавершённая операция. Повтор использует тот же ключ и тело запроса.');
          } else if (resolution.kind === 'already-saved') {
            clearApiPricingRecovery(
              window.localStorage,
              apiBaseUrl,
              id,
              next.document.layoutVersionId,
            );
            setPricingDraft(next.document);
            setNotice('Сверено с сервером: сохранённые назначения уже применены.');
          } else {
            setPricingDraft(resolution.document);
            setPricingNeedsRefresh(true);
            setPricingError('Локальный черновик относится к другой ревизии или каталогу. Изменения сохранены; сверьте серверное состояние перед продолжением.');
          }
        } else {
          setPricingDraft(next.document);
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && pricingLoadRef.current?.id === loadId)
        setPricingError(errorMessage(cause));
    } finally {
      if (pricingLoadRef.current?.id === loadId) {
        pricingLoadRef.current = null;
        setPricingLoading(false);
      }
    }
  }

  async function transmitPricingSave(attempt: PricingSaveAttempt) {
    const client = clientRef.current;
    if (!client) { setPricingError('Не задан VITE_HALL_API_BASE_URL'); return; }
    const baseline = pricingData;
    if (!baseURL || !baseline || baseline.document.occurrenceId !== attempt.document.occurrenceId) {
      setPricingError('Сеанс цен изменился. Перезагрузите серверное состояние перед сохранением.');
      return;
    }
    const apiBaseUrl = baseURL;
    try {
      saveApiPricingRecovery(window.localStorage, createApiPricingRecoveryRecord({
        apiBaseUrl,
        baseline,
        document: attempt.document,
        pendingAttempt: attempt,
      }));
    } catch {
      setPricingError('Не удалось сохранить локальную копию операции. Запрос не отправлен, поэтому его исход остаётся известен.');
      return;
    }
    pricingAttemptRef.current = attempt;
    setPricingAttempt(attempt);
    setBusy(true);
    setPricingError('');
    setNotice('');
    try {
      const response = await client.savePricingAssignments(
        attempt.document.occurrenceId,
        attempt.body,
        attempt.expectedRevision,
        attempt.idempotencyKey,
      );
      const savedDocument = mapApiPricingAssignments(response);
      if (
        savedDocument.layoutVersionId !== attempt.document.layoutVersionId ||
        savedDocument.catalogRevision !== attempt.document.catalogRevision
      ) throw new HallApiError('invalid_response', 'Сервер вернул назначения для другого контекста');

      pricingAttemptRef.current = null;
      setPricingAttempt(null);
      setPricingDraft(savedDocument);
      try {
        clearApiPricingRecovery(
          window.localStorage,
          apiBaseUrl,
          savedDocument.occurrenceId,
          savedDocument.layoutVersionId,
        );
      } catch {
        // A later server-baseline check can safely reconcile this stale local copy.
      }
      setPricingData((current) => current?.occurrence.id === savedDocument.occurrenceId
        ? { ...current, document: savedDocument }
        : current);
      setNotice('Назначения сохранены на сервере. Обновляем подтверждённые цены мероприятия…');
      try {
        const latestOccurrence = await client.getOccurrence(savedDocument.occurrenceId);
        if (latestOccurrence.layoutVersionId !== savedDocument.layoutVersionId)
          throw new HallApiError('layout_version_conflict', 'После сохранения изменилась версия схемы мероприятия');
        setPricingData((current) => current?.occurrence.id === latestOccurrence.id
          ? { ...current, occurrence: latestOccurrence, document: savedDocument }
          : current);
        setOccurrences((current) => current.map((item) => item.id === latestOccurrence.id ? latestOccurrence : item));
        setNotice('Назначения сохранены. Покупательские цены перечитаны с сервера.');
      } catch (cause) {
        setPricingError(`Назначения сохранены, но перечитать покупательские цены не удалось: ${errorMessage(cause)}`);
        setNotice('Сохранение назначений подтверждено сервером. Обновите мероприятие перед покупкой.');
      }
    } catch (cause) {
      if (isDefinitivePricingFailure(cause)) {
        pricingAttemptRef.current = null;
        setPricingAttempt(null);
        try {
          saveApiPricingRecovery(window.localStorage, createApiPricingRecoveryRecord({
            apiBaseUrl,
            baseline,
            document: attempt.document,
          }));
        } catch {
          setPricingError(`${errorMessage(cause)} Локальную копию черновика сохранить не удалось.`);
          return;
        }
        if (cause instanceof HallApiError && [
          'revision_conflict', 'pricing_catalog_conflict', 'layout_version_conflict',
        ].includes(cause.code)) setPricingNeedsRefresh(true);
      } else {
        pricingAttemptRef.current = attempt;
        setPricingAttempt(attempt);
      }
      setPricingError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function savePricing(document: PricingAssignmentDocument) {
    if (pricingAttemptRef.current) return;
    await transmitPricingSave(createPricingSaveAttempt(document));
  }

  const openHall = (id: string) => run(async (client) => {
    const [nextRecord, nextVersions] = await Promise.all([client.getHall(id), client.listPublished(id)]);
    setRecord(nextRecord);
    setDraft(nextRecord.draft);
    setVersions(nextVersions);
    setPage('editor');
  });
  const save = (value: HallLayoutDraft) => run(async (client) => {
    const next = record
      ? await client.saveDraft(value, record.revision, draftKey(value, 'save'))
      : await client.createHall(value, draftKey(value, 'save'));
    setRecord(next);
    setDraft(next.draft);
    setNotice('Сохранено на сервере');
    await loadCatalog(client);
  });
  const publish = (value: HallLayoutDraft, warningsAcknowledged: boolean) => run(async (client) => {
    if (!record) throw new HallApiError('invalid_request', 'Сначала сохраните зал');
    const result = await client.publishDraft(value, record.revision,
      draftKey(value, warningsAcknowledged ? 'publishWarnings' : 'publish'), warningsAcknowledged);
    setRecord(result.record);
    setDraft(result.record.draft);
    setVersions((previous) => [...previous, result.published]);
    setNotice(`Опубликована версия ${result.published.versionNumber}`);
    await loadCatalog(client);
  });
  const openOccurrence = (id: string) => run(async (client) => {
    const next = await client.getOccurrence(id);
    setOccurrence(next);
    const nextHold = activeHold(next.ownHold);
    setHold(nextHold);
    setSelection([]);
    setReceipt(null);
    setPricingBuyerTotalChanged(Boolean(nextHold && !sameTotal(
      displayedTotal(next, nextHold.selection), nextHold.total,
    )));
    shownTotalRef.current = null;
    pendingOrderRef.current = null;
    setPage('buyer');
  });
  const refreshOccurrence = async (client: Client, id: string) => {
    const next = await client.getOccurrence(id);
    setOccurrence(next);
    setHold(activeHold(next.ownHold));
  };
  const reserve = (items: readonly SeatSelectionItem[]) => run(async (client) => {
    if (!occurrence) return;
    shownTotalRef.current = displayedTotal(occurrence, items);
    const attempt = `hold:${occurrence.id}:${occurrence.availability.revision}:${JSON.stringify(items)}`;
    const next = await client.createHold(
      occurrence.id, items, bookingKey(attempt), occurrence.availability.revision,
    );
    bookingKeysRef.current.delete(attempt);
    setHold(next);
    setSelection([]);
    const totalChanged = !sameTotal(shownTotalRef.current, next.total);
    setPricingBuyerTotalChanged(totalChanged);
    setNotice(totalChanged
      ? 'Сервер подтвердил другую сумму. Проверьте и явно подтвердите новую стоимость перед покупкой.'
      : `Места удержаны до ${new Date(next.expiresAt).toLocaleTimeString('ru-RU')}`);
    await refreshOccurrence(client, occurrence.id);
  });
  const cancel = () => run(async (client) => {
    if (!hold || !occurrence) return;
    await client.cancelHold(hold.id, bookingKey(`cancel:${hold.id}`));
    bookingKeysRef.current.delete(`cancel:${hold.id}`);
    pendingOrderRef.current = null;
    setHold(null);
    setPricingBuyerTotalChanged(false);
    setSelection([]);
    setNotice('Удержание отменено');
    await refreshOccurrence(client, occurrence.id);
  });
  const checkout = () => run(async (client) => {
    if (!hold || !occurrence) return;
    const order = pendingOrderRef.current ?? await client.createOrder(hold.id, bookingKey(`order:${hold.id}`));
    pendingOrderRef.current = order;
    const confirmed = await client.checkoutOrder(order.id, bookingKey(`checkout:${order.id}`));
    if (confirmed.status !== 'confirmed') throw new HallApiError('checkout_pending', 'Заказ ещё не подтверждён сервером');
    setReceipt(confirmed);
    pendingOrderRef.current = null;
    bookingKeysRef.current.delete(`order:${hold.id}`);
    bookingKeysRef.current.delete(`checkout:${order.id}`);
    setHold(null);
    setPricingBuyerTotalChanged(false);
    setSelection([]);
    setNotice(`Покупка подтверждена: заказ ${confirmed.id}`);
    await refreshOccurrence(client, occurrence.id);
  });

  const buyer = occurrence ? mapBuyerOccurrence(occurrence) : null;
  const pricingBuyer = useMemo(
    () => pricingData ? mapBuyerOccurrence(pricingData.occurrence) : null,
    [pricingData],
  );
  const pricingPreview = useMemo(() => {
    if (!pricingData || !pricingDraft || !pricingBuyer) return { prices: { seats: {}, zones: {} }, error: '' };
    try {
      return {
        prices: createPricingPreviewPriceMap({
          snapshot: pricingBuyer.layout.snapshot,
          ...(pricingBuyer.layout.zoneBounds ? { zoneBounds: pricingBuyer.layout.zoneBounds } : {}),
          catalog: pricingData.catalog,
          document: pricingDraft,
        }),
        error: '',
      };
    } catch (cause) {
      return {
        prices: { seats: {}, zones: {} },
        error: cause instanceof Error ? cause.message : 'Черновик нельзя показать в предпросмотре.',
      };
    }
  }, [pricingData, pricingDraft, pricingBuyer]);

  if (!baseURL) return <main className="api-studio"><h1>API Studio</h1><p role="alert">Не задан VITE_HALL_API_BASE_URL</p></main>;
  return <main className="api-studio">
    <header className="api-studio-header">
      <h1>API Studio</h1>
      <button type="button" disabled={busy} onClick={() => {
        if (page !== 'pricing' || canLeavePricing()) {
          pricingLoadRef.current?.controller.abort();
          setPage('catalog');
          setError('');
        }
      }}>Все залы</button>
      <label>Токен доступа <input type="password" value={token} autoComplete="off"
        onChange={(event) => { setToken(event.target.value); tokenRef.current = event.target.value; }} /></label>
      <button type="button" disabled={busy} onClick={() => run(loadCatalog)}>Обновить</button>
    </header>
    {error && <p role="alert" className="api-studio-error">{error}</p>}
    {notice && <p role="status" className="api-studio-notice">{notice}</p>}
    {page === 'catalog' && <section className="api-studio-catalog">
      <h2>Залы</h2>
      <button type="button" className="api-primary" onClick={() => { setRecord(null); setDraft(createEmptyDraft('Новый зал')); setVersions([]); setPage('editor'); }}>Создать зал</button>
      <ul>{halls.map((hall) => <li key={hall.id}><button type="button" onClick={() => void openHall(hall.id)}>{hall.name}</button><span>Версия {hall.publishedVersionNumber}</span></li>)}</ul>
      {halls.length === 0 && <p className="api-studio-empty">Залов пока нет. Создайте первый зал или обновите список.</p>}
      <h2>Мероприятия</h2>
      <ul>{occurrences.map((item) => <li key={item.id}><button type="button" onClick={() => void openOccurrence(item.id)}>{item.title}</button><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString('ru-RU')}</time><button type="button" disabled={busy} onClick={() => void openPricing(item.id)}>Настроить цены</button></li>)}</ul>
      {occurrences.length === 0 && <p className="api-studio-empty">Доступных мероприятий пока нет.</p>}
    </section>}
    {page === 'editor' && draft && <section>
      <div className="api-studio-toolbar"><h2>{draft.hallName}</h2><span>Ревизия {record?.revision ?? 'новый зал'}</span>
        <button type="button" className="api-primary" disabled={busy} onClick={() => void save(draft)}>Сохранить на сервере</button>
        <button type="button" disabled={busy || !record} onClick={() => void publish(draft, false)}>Опубликовать на сервере</button>
      </div>
      {versions.length > 0 && <p>Опубликованные версии: {versions.map((version) => version.versionNumber).join(', ')}</p>}
      <HallEditor value={draft} saving={busy} publishedSeatIds={versions.flatMap((version) => version.layout.snapshot.seats.map((seat) => seat.id))}
        onChange={setDraft} onSave={save} onPublish={publish} onError={(cause) => setError(errorMessage(cause))} />
    </section>}
    {page === 'buyer' && buyer && <section aria-label={`Мероприятие ${buyer.title}`}>
      <div className="api-studio-toolbar"><h2>{buyer.title}</h2><time dateTime={buyer.startsAt}>{new Date(buyer.startsAt).toLocaleString('ru-RU')}</time>
        <button type="button" disabled={busy} onClick={() => void run((client) => refreshOccurrence(client, buyer.id))}>Обновить наличие</button>
      </div>
      {receipt ? <p role="status">Покупка подтверждена: заказ {receipt.id}, {formatMoney(receipt.total.amountMinor, receipt.total.currency)}</p>
        : hold ? <div className="api-studio-hold"><p>Удержание до {new Date(hold.expiresAt).toLocaleTimeString('ru-RU')}. Итого: {formatMoney(hold.total.amountMinor, hold.total.currency)}</p>
          {pricingBuyerTotalChanged && <p role="alert" className="api-studio-price-change">Сумма сервера отличается от последней показанной суммы. Сверьте итог и подтвердите новую стоимость.</p>}
          <button type="button" className="api-primary" disabled={busy} onClick={() => void checkout()}>{pricingBuyerTotalChanged ? 'Подтвердить новую сумму и покупку' : 'Подтвердить покупку'}</button>
          <button type="button" disabled={busy} onClick={() => void cancel()}>Отменить удержание</button></div>
        : null}
      <SeatView layout={buyer.layout} occurrenceId={buyer.id} availability={buyer.availability} prices={buyer.prices}
        selection={selection} onSelectionChange={setSelection} buying={busy || Boolean(hold) || Boolean(receipt)}
        onBuyClick={({ selection: items }) => reserve(items)} onError={(cause) => setError(errorMessage(cause))} />
    </section>}
    {page === 'pricing' && <section className="api-studio-pricing" aria-label="Назначение цен">
      <div className="api-studio-toolbar">
        <h2>{pricingData ? `Цены · ${pricingData.occurrence.title}` : 'Назначение цен'}</h2>
        <button type="button" disabled={busy} onClick={() => {
          if (canLeavePricing()) {
            pricingLoadRef.current?.controller.abort();
            setPage('catalog');
          }
        }}>‹ К мероприятиям</button>
        {pricingData && <button type="button" disabled={busy} onClick={() => {
          if (canLeavePricing()) void openOccurrence(pricingData.occurrence.id);
        }}>Покупательский экран</button>}
        {pricingData && <button type="button" aria-expanded={pricingPreviewOpen} onClick={() => setPricingPreviewOpen((open) => !open)}>
          {pricingPreviewOpen ? 'Скрыть предпросмотр' : 'Предпросмотр покупателя'}
        </button>}
      </div>
      {pricingLoading && <p role="status">Загружаем схему, каталог и назначения с сервера…</p>}
      {pricingError && <p role="alert" className="api-studio-error">{pricingError}</p>}
      {pricingError && pricingData && !pricingAttempt && <button type="button" disabled={busy} onClick={() => void openPricing(pricingData.occurrence.id, { discardRecovery: true })}>
        Сверить состояние с сервером
      </button>}
      {pricingAttempt && <div className="api-studio-pricing-retry" role="alert">
        <p>Результат PUT неизвестен. Черновик заблокирован; повтор будет отправлен с тем же телом и ключом.</p>
        <button type="button" className="api-primary" disabled={busy} onClick={() => void transmitPricingSave(pricingAttempt)}>
          Повторить сохранение с тем же ключом
        </button>
      </div>}
      {pricingData && pricingDraft && <>
        <p className="api-studio-pricing-context">Версия схемы {pricingData.document.layoutVersionId} · ревизия назначений {pricingData.document.revision}. Каталог доступен только для чтения; покупательские цены после сохранения перечитываются с API.</p>
        <PricingEditor
          layout={pricingBuyer!.layout}
          value={pricingDraft}
          catalog={pricingData.catalog}
          onChange={(next) => {
            setPricingDraft(next);
            if (!baseURL || !pricingData || pricingAttemptRef.current) return;
            try {
              saveApiPricingRecovery(window.localStorage, createApiPricingRecoveryRecord({
                apiBaseUrl: baseURL,
                baseline: pricingData,
                document: next,
              }));
            } catch {
              setPricingError('Локальную копию черновика сохранить не удалось. Перед отправкой запроса сохранение будет заблокировано.');
            }
          }}
          onSave={savePricing}
          saving={busy}
          readonly={Boolean(pricingAttempt) || pricingNeedsRefresh}
          error={null}
          locale="ru-RU"
        />
        {pricingPreviewOpen && <section className="api-studio-pricing-preview" aria-labelledby="api-pricing-preview-heading">
          <h2 id="api-pricing-preview-heading">Предпросмотр текущего черновика</h2>
          <p>Здесь показана локальная черновая карта. Удержания и заказы отключены; реальные цены доступны в покупательском экране после ответа сервера.</p>
          {pricingPreview.error && <p role="alert" className="api-studio-error">{pricingPreview.error}</p>}
          <SeatView
            layout={pricingBuyer!.layout}
            occurrenceId={pricingData.occurrence.id}
            availability={pricingBuyer!.availability}
            availabilityRevision={pricingBuyer!.availabilityRevision}
            prices={pricingPreview.prices}
            selection={pricingPreviewSelection}
            locale="ru-RU"
            purchaseDisabled
            onSelectionChange={setPricingPreviewSelection}
            onBuyClick={() => undefined}
            onError={(cause) => setPricingError(errorMessage(cause))}
          />
        </section>}
      </>}
      {!pricingLoading && !pricingData && !pricingError && <p role="status">Выберите мероприятие для загрузки назначений.</p>}
    </section>}
  </main>;
}

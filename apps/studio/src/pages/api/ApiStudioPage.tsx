import { useEffect, useRef, useState } from 'react';
import { createEmptyDraft, type HallLayoutDraft } from '@hall-platform/domain';
import { createHallApiClient, HallApiError, mapBuyerOccurrence, minorToMajor } from '@hall-platform/api-axios';
import type { ApiHallRecord, ApiHallSummary, ApiHold, ApiOccurrence, ApiOrder, ApiPublishedVersion } from '@hall-platform/api-contracts';
import { HallEditor } from '@hall-platform/hall-editor';
import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import './api-studio.css';

type Client = ReturnType<typeof createHallApiClient>;
type Page = 'catalog' | 'editor' | 'buyer';

function errorMessage(error: unknown): string {
  if (error instanceof HallApiError) {
    if (error.code === 'revision_conflict') return 'Схема изменилась на сервере. Обновите зал перед сохранением.';
    if (error.code === 'availability_conflict' || error.code === 'hold_expired')
      return 'Места изменились или удержание истекло. Обновите мероприятие и выберите снова.';
    return error.message;
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

export default function ApiStudioPage() {
  const clientRef = useRef<Client | null>(null);
  const tokenRef = useRef('');
  const draftKeysRef = useRef(new WeakMap<HallLayoutDraft, { save?: string; publish?: string; publishWarnings?: string }>());
  const bookingKeysRef = useRef(new Map<string, string>());
  const pendingOrderRef = useRef<ApiOrder | null>(null);
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const baseURL = import.meta.env.VITE_HALL_API_BASE_URL as string | undefined;

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
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [baseURL]);

  useEffect(() => {
    if (!hold || !occurrence) return;
    const remaining = Date.parse(hold.expiresAt) - Date.now();
    const timer = window.setTimeout(() => {
      setHold(null);
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
    setHold(activeHold(next.ownHold));
    setSelection([]);
    setReceipt(null);
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
    const attempt = `hold:${occurrence.id}:${occurrence.availability.revision}:${JSON.stringify(items)}`;
    const next = await client.createHold(
      occurrence.id, items, bookingKey(attempt), occurrence.availability.revision,
    );
    bookingKeysRef.current.delete(attempt);
    setHold(next);
    setNotice(`Места удержаны до ${new Date(next.expiresAt).toLocaleTimeString('ru-RU')}`);
    await refreshOccurrence(client, occurrence.id);
  });
  const cancel = () => run(async (client) => {
    if (!hold || !occurrence) return;
    await client.cancelHold(hold.id, bookingKey(`cancel:${hold.id}`));
    bookingKeysRef.current.delete(`cancel:${hold.id}`);
    pendingOrderRef.current = null;
    setHold(null);
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
    setSelection([]);
    setNotice(`Покупка подтверждена: заказ ${confirmed.id}`);
    await refreshOccurrence(client, occurrence.id);
  });

  if (!baseURL) return <main className="api-studio"><h1>API Studio</h1><p role="alert">Не задан VITE_HALL_API_BASE_URL</p></main>;
  const buyer = occurrence ? mapBuyerOccurrence(occurrence) : null;
  return <main className="api-studio">
    <header className="api-studio-header">
      <h1>API Studio</h1>
      <button type="button" onClick={() => { setPage('catalog'); setError(''); }}>Все залы</button>
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
      <ul>{occurrences.map((item) => <li key={item.id}><button type="button" onClick={() => void openOccurrence(item.id)}>{item.title}</button><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString('ru-RU')}</time></li>)}</ul>
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
          <button type="button" className="api-primary" disabled={busy} onClick={() => void checkout()}>Подтвердить покупку</button>
          <button type="button" disabled={busy} onClick={() => void cancel()}>Отменить удержание</button></div>
        : null}
      <SeatView layout={buyer.layout} occurrenceId={buyer.id} availability={buyer.availability} prices={buyer.prices}
        selection={selection} onSelectionChange={setSelection} buying={busy || Boolean(hold) || Boolean(receipt)}
        onBuyClick={({ selection: items }) => reserve(items)} onError={(cause) => setError(errorMessage(cause))} />
    </section>}
  </main>;
}

import type { SeatSelectionItem } from '@hall-platform/seat-view';
import {
  layoutSnapshotSchema,
  createDraftFromSnapshot,
  pricingAssignmentDocumentSchema,
  seatStatusSchema,
  type Background,
  type PricingAssignmentDocument,
  type PricingCatalog,
} from '@hall-platform/domain';
import type { HallLayoutDraft } from '@hall-platform/hall-editor';
import { parseHallLayoutDraft } from '@hall-platform/hall-editor';
import {
  decodeStoredDraft,
  encodeStoredDraft,
  HallStorageError,
  type StoredDraft,
} from '@hall-platform/local-storage';
import {
  cancelDemoHold,
  confirmDemoHold,
  demoPriceQuoteSchema,
  holdDemoSelection,
  type DemoOccurrence,
} from './demoBooking.js';
import {
  demoPricingAssignmentRecordSchema,
  demoPricingRecoveryRecordSchema,
  type DemoPricingAssignmentRecord,
  type DemoPricingRecoveryRecord,
  buildDemoPricingPrices,
} from './demoPricing.js';
import {
  demoBookingTransaction,
} from '../../../shared/storage/demoBookingDatabase.js';
import { reconcileOccurrenceLayout } from './reconcileOccurrenceInventory.js';

const ownerKey = 'hall-platform-demo-booking-owner';
const changeKey = 'hall-platform-demo-booking-change';
let fallbackOwnerId: string | null = null;

type OccurrenceEditorMaterialsRecord = Readonly<{
  schemaVersion: 1;
  occurrenceId: string;
  ownerScope: 'occurrence';
  sourceHallId: string;
  baseLayoutVersionId: string;
  layoutVersionId: string;
  revision: number;
  updatedAt: number;
  backgrounds: readonly Background[];
  assets: StoredDraft['assets'];
  calibration: HallLayoutDraft['calibration'];
  blobs: Readonly<Record<string, Blob>>;
}>;

type OccurrenceStorageBundle = Readonly<{
  occurrence: unknown;
  materials: unknown;
}>;

async function encodeOccurrenceEditorMaterials(
  occurrence: DemoOccurrence,
  draft: HallLayoutDraft,
): Promise<OccurrenceEditorMaterialsRecord> {
  if (draft.snapshot.layoutVersionId !== occurrence.layout.snapshot.layoutVersionId)
    throw new HallStorageError('conflict', 'Материалы редактора относятся к другой версии схемы мероприятия');
  const encoded = await encodeStoredDraft(draft);
  return {
    schemaVersion: 1,
    occurrenceId: occurrence.id,
    ownerScope: 'occurrence',
    sourceHallId: occurrence.hallId,
    baseLayoutVersionId: occurrence.sourceLayoutVersionId ?? occurrence.layout.snapshot.layoutVersionId,
    layoutVersionId: occurrence.layout.snapshot.layoutVersionId,
    revision: occurrence.revision,
    updatedAt: Date.now(),
    backgrounds: encoded.draft.snapshot.backgrounds,
    assets: encoded.draft.assets,
    calibration: encoded.draft.calibration,
    blobs: Object.fromEntries(encoded.blobs.map(({ key, blob }) => [key, blob])),
  };
}

function parseOccurrenceEditorMaterials(
  value: unknown,
): OccurrenceEditorMaterialsRecord | null {
  if (value === undefined) return null;
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.ownerScope !== 'occurrence' ||
    typeof value.occurrenceId !== 'string' ||
    typeof value.sourceHallId !== 'string' ||
    typeof value.baseLayoutVersionId !== 'string' ||
    typeof value.layoutVersionId !== 'string' ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Number.isFinite(value.updatedAt) ||
    !Array.isArray(value.backgrounds) ||
    !isRecord(value.assets) ||
    !isRecord(value.blobs) ||
    !Object.values(value.blobs).every((blob) => typeof Blob !== 'undefined' && blob instanceof Blob)
  ) {
    throw new HallStorageError('corrupt', 'Локальные материалы схемы мероприятия повреждены');
  }
  return value as unknown as OccurrenceEditorMaterialsRecord;
}

async function decodeOccurrenceEditorMaterials(
  occurrence: DemoOccurrence,
  rawMaterials: unknown,
): Promise<HallLayoutDraft | null> {
  const materials = parseOccurrenceEditorMaterials(rawMaterials);
  if (!materials) return null;
  if (
    materials.occurrenceId !== occurrence.id ||
    materials.sourceHallId !== occurrence.hallId ||
    materials.baseLayoutVersionId !== (occurrence.sourceLayoutVersionId ?? materials.baseLayoutVersionId) ||
    materials.layoutVersionId !== occurrence.layout.snapshot.layoutVersionId
  ) return null;
  const draftBase = createDraftFromSnapshot(occurrence.layout.hallName, {
    ...occurrence.layout.snapshot,
    backgrounds: [...materials.backgrounds],
  });
  const storedDraft: StoredDraft = {
    ...draftBase,
    assets: materials.assets,
    calibration: materials.calibration,
  };
  return decodeStoredDraft(storedDraft, async (key) => materials.blobs[key]);
}

function withoutInlineEditorLayout(occurrence: DemoOccurrence): Omit<DemoOccurrence, 'editorLayout'> {
  const { editorLayout: _editorLayout, ...stored } = occurrence;
  return stored;
}

async function hydrateOccurrenceBundle(
  raw: unknown,
  rawMaterials: unknown,
): Promise<DemoOccurrence | null> {
  const occurrence = parseDemoOccurrence(raw);
  if (!occurrence) return null;
  const editorLayout = await decodeOccurrenceEditorMaterials(occurrence, rawMaterials);
  if (editorLayout) return { ...occurrence, editorLayout };
  if (rawMaterials !== undefined) {
    const { editorLayout: _staleEditorLayout, ...withoutStaleMaterials } = occurrence;
    return withoutStaleMaterials;
  }
  if (occurrence.editorLayout?.snapshot.layoutVersionId === occurrence.layout.snapshot.layoutVersionId)
    return occurrence;
  const { editorLayout: _staleEditorLayout, ...withoutStaleMaterials } = occurrence;
  return withoutStaleMaterials;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSelection(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        ((item.kind === 'seat' && typeof item.seatId === 'string') ||
          (item.kind === 'generalAdmission' &&
            typeof item.zoneId === 'string' &&
            Number.isSafeInteger(item.quantity) &&
            (item.quantity as number) > 0)),
    )
  );
}

export function parseDemoOccurrence(value: unknown): DemoOccurrence | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2)
  )
    return null;
  if (
    typeof value.id !== 'string' ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.hallId !== 'string' ||
    (value.sourceLayoutVersionId !== undefined &&
      (typeof value.sourceLayoutVersionId !== 'string' || !value.sourceLayoutVersionId)) ||
    typeof value.title !== 'string' ||
    typeof value.startsAt !== 'string' ||
    Number.isNaN(Date.parse(value.startsAt)) ||
    !isRecord(value.layout) ||
    typeof value.layout.hallName !== 'string' ||
    !layoutSnapshotSchema.safeParse(value.layout.snapshot).success ||
    (value.editorLayout !== undefined && !parseHallLayoutDraftSafe(value.editorLayout)) ||
    !isRecord(value.initialSeats) ||
    !Object.values(value.initialSeats).every(
      (status) => seatStatusSchema.safeParse(status).success,
    ) ||
    !isRecord(value.zoneCapacity) ||
    !Object.values(value.zoneCapacity).every(
      (amount) => Number.isSafeInteger(amount) && (amount as number) >= 0,
    ) ||
    !isRecord(value.prices) ||
    !isRecord(value.prices.seats) ||
    !isRecord(value.prices.zones) ||
    !Array.isArray(value.holds) ||
    !Array.isArray(value.orders)
  )
    return null;
  const validPrice = (price: unknown) =>
    isRecord(price) &&
    typeof price.amount === 'number' &&
    Number.isFinite(price.amount) &&
    price.amount >= 0 &&
    typeof price.currency === 'string';
  if (
    !Object.values(value.prices.seats).every(validPrice) ||
    !Object.values(value.prices.zones).every(validPrice)
  )
    return null;
  const version = value.schemaVersion === 2 ? 2 : 1;
  if (
    !value.holds.every((hold: unknown) => {
      if (
        !isRecord(hold) ||
        typeof hold.id !== 'string' ||
        !Number.isFinite(hold.expiresAt) ||
        !isSelection(hold.selection) ||
        (hold.ownerId !== undefined && typeof hold.ownerId !== 'string')
      ) return false;
      return version === 1 || demoPriceQuoteSchema.safeParse(hold.quote).success;
    })
  )
    return null;
  if (
    !value.orders.every((order: unknown) => {
      if (
        !isRecord(order) ||
        typeof order.id !== 'string' ||
        !Number.isFinite(order.confirmedAt) ||
        !isSelection(order.selection)
      ) return false;
      return version === 1 || order.quote === null || demoPriceQuoteSchema.safeParse(order.quote).success;
    })
  )
    return null;
  const legacyActiveHold =
    version === 1 &&
    value.holds.some(
      (hold: unknown) =>
        isRecord(hold) &&
        typeof hold.expiresAt === 'number' &&
        hold.expiresAt > Date.now() &&
        !demoPriceQuoteSchema.safeParse(hold.quote).success,
    );
  const holds = value.holds.flatMap((hold: unknown) => {
    if (!isRecord(hold)) return [];
    const quote = demoPriceQuoteSchema.safeParse(hold.quote);
    if (!quote.success) return [];
    return [{ ...hold, quote: quote.data }];
  });
  const orders = value.orders.map((order: unknown) => {
    if (!isRecord(order)) return order;
    const quote = demoPriceQuoteSchema.safeParse(order.quote);
    return { ...order, quote: quote.success ? quote.data : null };
  });
  return {
    ...value,
    schemaVersion: 2,
    sourceLayoutVersionId:
      typeof value.sourceLayoutVersionId === 'string'
        ? value.sourceLayoutVersionId
        : (value.layout as { snapshot: { layoutVersionId: string } }).snapshot.layoutVersionId,
    holds,
    orders,
    ...((value.legacyQuoteNotice === true || legacyActiveHold)
      ? { legacyQuoteNotice: true }
      : {}),
  } as DemoOccurrence;
}

function parseHallLayoutDraftSafe(value: unknown): boolean {
  try {
    parseHallLayoutDraft(value);
    return true;
  } catch {
    return false;
  }
}

export function getDemoOwnerId(): string {
  try {
    if (typeof sessionStorage === 'undefined')
      return (fallbackOwnerId ??= crypto.randomUUID());
    let ownerId = sessionStorage.getItem(ownerKey);
    if (!ownerId) {
      ownerId = crypto.randomUUID();
      sessionStorage.setItem(ownerKey, ownerId);
    }
    return ownerId;
  } catch {
    return (fallbackOwnerId ??= crypto.randomUUID());
  }
}

function announceChange(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const channel = new BroadcastChannel(changeKey);
    channel.postMessage(id);
    channel.close();
  } catch {
    /* storage event is the fallback */
  }
  try {
    localStorage.setItem(
      changeKey,
      JSON.stringify({ id, nonce: crypto.randomUUID() }),
    );
  } catch {
    /* BroadcastChannel and focus remain available */
  }
}

export function subscribeToDemoChanges(
  onChange: (id: string | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(changeKey);
    channel.onmessage = (event: MessageEvent<string>) => onChange(event.data);
  } catch {
    /* storage event is the fallback */
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== changeKey || !event.newValue) return;
    try {
      onChange((JSON.parse(event.newValue) as { id: string }).id);
    } catch {
      onChange(null);
    }
  };
  const onFocus = () => onChange(null);
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onFocus);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', onFocus);
  };
}

async function transactionResult<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolveValue: (value: T) => void,
    rejectValue: (error: Error) => void,
  ) => void,
): Promise<T> {
  return demoBookingTransaction(['occurrences'], mode, (transaction, resolve, reject) =>
    operation(transaction.objectStore('occurrences'), resolve, reject),
  );
}

async function readOccurrenceBundle(id: string): Promise<OccurrenceStorageBundle> {
  return demoBookingTransaction<OccurrenceStorageBundle>(
    ['occurrences', 'occurrenceEditorMaterials'],
    'readonly',
    (transaction, resolveValue) => {
      const occurrenceRequest = transaction.objectStore('occurrences').get(id);
      const materialsRequest = transaction.objectStore('occurrenceEditorMaterials').get(id);
      let occurrenceReady = false;
      let materialsReady = false;
      let occurrence: unknown;
      let materials: unknown;
      const resolveWhenReady = () => {
        if (occurrenceReady && materialsReady) resolveValue({ occurrence, materials });
      };
      occurrenceRequest.onsuccess = () => {
        occurrence = occurrenceRequest.result;
        occurrenceReady = true;
        resolveWhenReady();
      };
      materialsRequest.onsuccess = () => {
        materials = materialsRequest.result;
        materialsReady = true;
        resolveWhenReady();
      };
    },
  );
}

async function readAllOccurrenceBundles(): Promise<OccurrenceStorageBundle[]> {
  return demoBookingTransaction<OccurrenceStorageBundle[]>(
    ['occurrences', 'occurrenceEditorMaterials'],
    'readonly',
    (transaction, resolveValue) => {
      const occurrenceRequest = transaction.objectStore('occurrences').getAll();
      const materialsRequest = transaction.objectStore('occurrenceEditorMaterials').getAll();
      let occurrenceReady = false;
      let materialsReady = false;
      let occurrences: unknown[] = [];
      let materials: unknown[] = [];
      const resolveWhenReady = () => {
        if (!occurrenceReady || !materialsReady) return;
        const byId = new Map(
          materials.filter(isRecord).map((record) => [record.occurrenceId, record] as const),
        );
        resolveValue(occurrences.map((record) => ({
          occurrence: record,
          materials: isRecord(record) ? byId.get(record.id) : undefined,
        })));
      };
      occurrenceRequest.onsuccess = () => {
        occurrences = occurrenceRequest.result as unknown[];
        occurrenceReady = true;
        resolveWhenReady();
      };
      materialsRequest.onsuccess = () => {
        materials = materialsRequest.result as unknown[];
        materialsReady = true;
        resolveWhenReady();
      };
    },
  );
}

export const demoBookingRepository = {
  list: async () => {
    const bundles = await readAllOccurrenceBundles();
    const occurrences = await Promise.all(
      bundles.map(({ occurrence, materials }) => hydrateOccurrenceBundle(occurrence, materials)),
    );
    return occurrences.filter((item): item is DemoOccurrence => item !== null);
  },
  get: async (id: string) => {
    const bundle = await readOccurrenceBundle(id);
    return hydrateOccurrenceBundle(bundle.occurrence, bundle.materials);
  },
  ensure: async (occurrence: DemoOccurrence) => {
    const existing = await demoBookingRepository.get(occurrence.id);
    if (existing) {
      if (existing.editorLayout) {
        const bundle = await readOccurrenceBundle(existing.id);
        if (bundle.materials === undefined) {
          const record = await encodeOccurrenceEditorMaterials(existing, existing.editorLayout);
          await demoBookingTransaction<void>(
            ['occurrences', 'occurrenceEditorMaterials'],
            'readwrite',
            (transaction, resolveValue) => {
              const occurrenceStore = transaction.objectStore('occurrences');
              const materialsStore = transaction.objectStore('occurrenceEditorMaterials');
              const occurrenceRequest = occurrenceStore.get(existing.id);
              const materialsRequest = materialsStore.get(existing.id);
              let ready = 0;
              const migrateWhenReady = () => {
                if (++ready !== 2) return;
                const current = parseDemoOccurrence(occurrenceRequest.result);
                if (
                  current?.revision === existing.revision &&
                  materialsRequest.result === undefined &&
                  current.editorLayout?.snapshot.layoutVersionId === record.layoutVersionId
                ) {
                  occurrenceStore.put(withoutInlineEditorLayout(current));
                  materialsStore.put(record);
                }
                resolveValue();
              };
              occurrenceRequest.onsuccess = migrateWhenReady;
              materialsRequest.onsuccess = migrateWhenReady;
            },
          );
        }
      }
      return (await demoBookingRepository.get(occurrence.id)) ?? existing;
    }

    const materials = occurrence.editorLayout
      ? await encodeOccurrenceEditorMaterials(occurrence, occurrence.editorLayout)
      : null;
    const created = await demoBookingTransaction<boolean>(
      ['occurrences', 'occurrenceEditorMaterials'],
      'readwrite',
      (transaction, resolveValue) => {
        const store = transaction.objectStore('occurrences');
        const materialsStore = transaction.objectStore('occurrenceEditorMaterials');
        const request = store.get(occurrence.id);
        request.onsuccess = () => {
          if (request.result !== undefined) {
            resolveValue(false);
            return;
          }
          store.put(withoutInlineEditorLayout(occurrence));
          if (materials) materialsStore.put(materials);
          resolveValue(true);
        };
      },
    );
    if (!created) return (await demoBookingRepository.get(occurrence.id)) ?? occurrence;
    return occurrence;
  },
  update: async (
    id: string,
    mutate: (current: DemoOccurrence) => DemoOccurrence,
  ) => {
    const occurrence = await transactionResult<DemoOccurrence>(
      'readwrite',
      (store, resolveValue, rejectValue) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const current = parseDemoOccurrence(request.result);
          if (!current) {
            rejectValue(new Error('Демо-мероприятие не найдено'));
            return;
          }
          try {
            const next = mutate(current);
            const validated = parseDemoOccurrence({ ...next, schemaVersion: 2 });
            if (!validated) throw new Error('Демо-бронирование содержит некорректные данные');
            store.put(validated);
            resolveValue(validated);
          } catch (error) {
            rejectValue(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        };
      },
    );
    announceChange(id);
    return occurrence;
  },
  hold: (id: string, selection: readonly SeatSelectionItem[]) =>
    demoBookingRepository.update(id, (current) =>
      holdDemoSelection(current, selection, Date.now(), getDemoOwnerId()),
    ),
  confirm: (id: string, holdId: string) =>
    demoBookingRepository.update(id, (current) =>
      confirmDemoHold(current, holdId, Date.now(), getDemoOwnerId()),
    ),
  cancel: (id: string, holdId: string) =>
    demoBookingRepository.update(id, (current) =>
      cancelDemoHold(current, holdId, getDemoOwnerId()),
    ),
  getPricingAssignments: async (occurrenceId: string) =>
    demoBookingTransaction<DemoPricingAssignmentRecord | null>(
      ['pricingAssignments'],
      'readonly',
      (transaction, resolveValue) => {
        const request = transaction.objectStore('pricingAssignments').get(occurrenceId);
        request.onsuccess = () => {
          if (request.result === undefined) {
            resolveValue(null);
            return;
          }
          const parsed = demoPricingAssignmentRecordSchema.safeParse(request.result);
          if (!parsed.success || parsed.data.occurrenceId !== occurrenceId) {
            resolveValue(null);
            return;
          }
          resolveValue(parsed.data);
        };
      },
    ),
  getPricingRecovery: async (occurrenceId: string) => {
    const raw = await demoBookingTransaction<unknown | null>(
      ['pricingRecovery'],
      'readonly',
      (transaction, resolveValue) => {
        const request = transaction.objectStore('pricingRecovery').get(occurrenceId);
        request.onsuccess = () => resolveValue(request.result ?? null);
      },
    );
    if (raw === null || !isRecord(raw)) return null;
    const { layoutDraft: rawLayoutDraft, layoutBlobs, ...baseRecord } = raw;
    const parsed = demoPricingRecoveryRecordSchema.safeParse(baseRecord);
    if (
      !parsed.success ||
      parsed.data.occurrenceId !== occurrenceId ||
      parsed.data.document.occurrenceId !== occurrenceId ||
      parsed.data.document.layoutVersionId !== parsed.data.layoutVersionId ||
      parsed.data.document.catalogRevision !== parsed.data.catalogRevision
    ) return null;
    let layoutDraft: HallLayoutDraft | undefined;
    if (rawLayoutDraft !== undefined) {
      const blobs = layoutBlobs === undefined ? {} : layoutBlobs;
      if (!isRecord(blobs) || !Object.values(blobs).every((blob) => typeof Blob !== 'undefined' && blob instanceof Blob))
        throw new HallStorageError('corrupt', 'Файлы локального восстановления схемы повреждены');
      layoutDraft = await decodeStoredDraft(
        rawLayoutDraft as StoredDraft,
        async (key) => (blobs as Record<string, Blob>)[key],
      );
    }
    return demoPricingRecoveryRecordSchema.parse({
      ...parsed.data,
      ...(layoutDraft ? { layoutDraft } : {}),
    });
  },
  savePricingRecovery: async (record: DemoPricingRecoveryRecord) => {
    const parsed = demoPricingRecoveryRecordSchema.parse(record);
    if (
      parsed.document.occurrenceId !== parsed.occurrenceId ||
      parsed.document.layoutVersionId !== parsed.layoutVersionId ||
      parsed.document.catalogRevision !== parsed.catalogRevision ||
      parsed.document.revision !== parsed.baseRevision
    ) throw new Error('Контекст черновика цен не совпадает с восстановлением');
    const { layoutDraft, ...baseRecord } = parsed;
    let persisted: Record<string, unknown> = baseRecord;
    if (layoutDraft) {
      const encoded = await encodeStoredDraft(layoutDraft);
      persisted = {
        ...baseRecord,
        layoutDraft: encoded.draft,
        layoutBlobs: Object.fromEntries(encoded.blobs.map(({ key, blob }) => [key, blob])),
      };
    }
    await demoBookingTransaction<void>(['pricingRecovery'], 'readwrite', (transaction, resolveValue) => {
      transaction.objectStore('pricingRecovery').put(persisted);
      resolveValue();
    });
  },
  clearPricingRecovery: async (occurrenceId: string) => {
    await demoBookingTransaction<void>(['pricingRecovery'], 'readwrite', (transaction, resolveValue) => {
      transaction.objectStore('pricingRecovery').delete(occurrenceId);
      resolveValue();
    });
  },
  savePricingAssignments: async (input: {
    occurrenceId: string;
    expectedAssignmentRevision: number;
    expectedOccurrenceRevision: number;
    catalog: PricingCatalog;
    document: PricingAssignmentDocument;
  }) => {
    const result = await demoBookingTransaction<{
      occurrence: DemoOccurrence;
      document: PricingAssignmentDocument;
    }>(['occurrences', 'pricingAssignments'], 'readwrite', (transaction, resolveValue, rejectValue) => {
      const occurrenceStore = transaction.objectStore('occurrences');
      const assignmentStore = transaction.objectStore('pricingAssignments');
      const occurrenceRequest = occurrenceStore.get(input.occurrenceId);
      const assignmentRequest = assignmentStore.get(input.occurrenceId);
      let occurrenceReady = false;
      let assignmentReady = false;
      let storedOccurrence: DemoOccurrence | null = null;
      let storedDocument: PricingAssignmentDocument | null = null;
      const saveWhenReady = () => {
        if (!occurrenceReady || !assignmentReady) return;
        if (!storedOccurrence) {
          rejectValue(new Error('Демо-мероприятие не найдено'));
          return;
        }
        if (storedOccurrence.revision !== input.expectedOccurrenceRevision) {
          rejectValue(new Error('Данные мероприятия изменились; перезагрузите цены'));
          return;
        }
        if ((storedDocument?.revision ?? 0) !== input.expectedAssignmentRevision) {
          rejectValue(new Error('Назначения цен изменились в другой вкладке'));
          return;
        }
        const nextDocument = {
          ...input.document,
          revision: input.expectedAssignmentRevision + 1,
        };
        const validation = pricingAssignmentDocumentSchema.safeParse(nextDocument);
        if (!validation.success) {
          rejectValue(new Error('Документ назначений цен некорректен'));
          return;
        }
        let prices;
        try {
          prices = buildDemoPricingPrices({
            occurrence: storedOccurrence,
            catalog: input.catalog,
            document: validation.data,
          });
        } catch (error) {
          rejectValue(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        const updatedOccurrence = {
          ...storedOccurrence,
          revision: storedOccurrence.revision + 1,
          prices,
          schemaVersion: 2 as const,
        };
        const record = demoPricingAssignmentRecordSchema.parse({
          schemaVersion: 1,
          occurrenceId: input.occurrenceId,
          document: validation.data,
        });
        occurrenceStore.put(updatedOccurrence);
        assignmentStore.put(record);
        resolveValue({ occurrence: updatedOccurrence, document: validation.data });
      };
      occurrenceRequest.onsuccess = () => {
        storedOccurrence = parseDemoOccurrence(occurrenceRequest.result);
        occurrenceReady = true;
        saveWhenReady();
      };
      assignmentRequest.onsuccess = () => {
        if (assignmentRequest.result !== undefined) {
          const parsed = demoPricingAssignmentRecordSchema.safeParse(assignmentRequest.result);
          if (!parsed.success || parsed.data.occurrenceId !== input.occurrenceId) {
            rejectValue(new Error('Сохранённые назначения цен повреждены'));
            return;
          }
          storedDocument = parsed.data.document;
        }
        assignmentReady = true;
        saveWhenReady();
      };
    });
    announceChange(input.occurrenceId);
    return result;
  },
  saveOccurrenceLayout: async (input: {
    occurrenceId: string;
    expectedOccurrenceRevision: number;
    expectedAssignmentRevision: number;
    expectedLayoutVersionId: string;
    catalog: PricingCatalog;
    layout: HallLayoutDraft;
    document: PricingAssignmentDocument;
  }) => {
    const baselineOccurrence = await demoBookingRepository.get(input.occurrenceId);
    if (
      !baselineOccurrence ||
      baselineOccurrence.revision !== input.expectedOccurrenceRevision ||
      baselineOccurrence.layout.snapshot.layoutVersionId !== input.expectedLayoutVersionId
    )
      throw new Error('Данные мероприятия изменились в другой вкладке');
    const reconciled = reconcileOccurrenceLayout(baselineOccurrence, input.layout);
    if (reconciled.conflicts.length)
      throw new Error(reconciled.conflicts.map(({ message }) => message).join(' '));
    const localMaterials = reconciled.occurrence.editorLayout
      ? await encodeOccurrenceEditorMaterials(reconciled.occurrence, reconciled.occurrence.editorLayout)
      : null;
    const result = await demoBookingTransaction<{
      occurrence: DemoOccurrence;
      document: PricingAssignmentDocument;
    }>(['occurrences', 'pricingAssignments', 'pricingRecovery', 'occurrenceEditorMaterials'], 'readwrite', (transaction, resolveValue, rejectValue) => {
      const occurrenceStore = transaction.objectStore('occurrences');
      const assignmentsStore = transaction.objectStore('pricingAssignments');
      const recoveryStore = transaction.objectStore('pricingRecovery');
      const materialsStore = transaction.objectStore('occurrenceEditorMaterials');
      const occurrenceRequest = occurrenceStore.get(input.occurrenceId);
      const assignmentsRequest = assignmentsStore.get(input.occurrenceId);
      let storedOccurrence: DemoOccurrence | null = null;
      let storedDocument: PricingAssignmentDocument | null = null;
      let occurrenceReady = false;
      let assignmentsReady = false;
      const saveWhenReady = () => {
        if (!occurrenceReady || !assignmentsReady) return;
        if (
          !storedOccurrence ||
          storedOccurrence.revision !== input.expectedOccurrenceRevision ||
          storedOccurrence.layout.snapshot.layoutVersionId !== input.expectedLayoutVersionId
        ) {
          rejectValue(new Error('Данные мероприятия изменились в другой вкладке'));
          return;
        }
        if ((storedDocument?.revision ?? 0) !== input.expectedAssignmentRevision) {
          rejectValue(new Error('Назначения цен изменились в другой вкладке'));
          return;
        }
        const nextDocument = pricingAssignmentDocumentSchema.parse({
          ...input.document,
          layoutVersionId: reconciled.occurrence.layout.snapshot.layoutVersionId,
          revision: input.expectedAssignmentRevision + 1,
          assignments: {
            seatSegments: Object.fromEntries(Object.entries(input.document.assignments.seatSegments).filter(([id]) => reconciled.occurrence.layout.snapshot.seats.some((seat) => seat.id === id))),
            gaZoneSegments: Object.fromEntries(Object.entries(input.document.assignments.gaZoneSegments).filter(([id]) => reconciled.occurrence.layout.snapshot.zones.some((zone) => zone.id === id && zone.kind === 'ga'))),
          },
        });
        let prices;
        try {
          prices = buildDemoPricingPrices({ occurrence: reconciled.occurrence, catalog: input.catalog, document: nextDocument });
        } catch (error) {
          rejectValue(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        const updatedOccurrence = { ...reconciled.occurrence, prices };
        occurrenceStore.put(withoutInlineEditorLayout(updatedOccurrence));
        assignmentsStore.put({ schemaVersion: 1, occurrenceId: input.occurrenceId, document: nextDocument });
        if (localMaterials) materialsStore.put(localMaterials);
        else materialsStore.delete(input.occurrenceId);
        recoveryStore.delete(input.occurrenceId);
        resolveValue({ occurrence: updatedOccurrence, document: nextDocument });
      };
      occurrenceRequest.onsuccess = () => {
        storedOccurrence = parseDemoOccurrence(occurrenceRequest.result);
        occurrenceReady = true;
        saveWhenReady();
      };
      assignmentsRequest.onsuccess = () => {
        if (assignmentsRequest.result !== undefined) {
          const parsed = demoPricingAssignmentRecordSchema.safeParse(assignmentsRequest.result);
          if (!parsed.success || parsed.data.occurrenceId !== input.occurrenceId) {
            rejectValue(new Error('Сохранённые назначения цен повреждены'));
            return;
          }
          storedDocument = parsed.data.document;
        }
        assignmentsReady = true;
        saveWhenReady();
      };
    });
    announceChange(input.occurrenceId);
    return result;
  },
  clear: async () => {
    await demoBookingTransaction<void>(
      ['occurrences', 'pricingAssignments', 'pricingRecovery', 'occurrenceEditorMaterials'],
      'readwrite',
      (transaction, resolveValue) => {
        transaction.objectStore('occurrences').clear();
        transaction.objectStore('pricingAssignments').clear();
        transaction.objectStore('pricingRecovery').clear();
        transaction.objectStore('occurrenceEditorMaterials').clear();
        resolveValue();
      },
    );
    announceChange('*');
  },
};

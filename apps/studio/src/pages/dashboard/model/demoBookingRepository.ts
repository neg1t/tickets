import type { SeatSelectionItem } from '@hall-platform/seat-view';
import {
  layoutSnapshotSchema,
  pricingAssignmentDocumentSchema,
  seatStatusSchema,
  type PricingAssignmentDocument,
  type PricingCatalog,
} from '@hall-platform/domain';
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

const ownerKey = 'hall-platform-demo-booking-owner';
const changeKey = 'hall-platform-demo-booking-change';
let fallbackOwnerId: string | null = null;

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
    typeof value.title !== 'string' ||
    typeof value.startsAt !== 'string' ||
    Number.isNaN(Date.parse(value.startsAt)) ||
    !isRecord(value.layout) ||
    typeof value.layout.hallName !== 'string' ||
    !layoutSnapshotSchema.safeParse(value.layout.snapshot).success ||
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
    holds,
    orders,
    ...((value.legacyQuoteNotice === true || legacyActiveHold)
      ? { legacyQuoteNotice: true }
      : {}),
  } as DemoOccurrence;
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

export const demoBookingRepository = {
  list: () =>
    transactionResult<DemoOccurrence[]>('readwrite', (store, resolveValue) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const occurrences = request.result
          .map(parseDemoOccurrence)
          .filter((item): item is DemoOccurrence => item !== null);
        for (const occurrence of occurrences) {
          const stored = request.result.find(
            (candidate: unknown) => isRecord(candidate) && candidate.id === occurrence.id,
          );
          if (isRecord(stored) && stored.schemaVersion !== 2)
            store.put(occurrence);
        }
        resolveValue(occurrences);
      };
    }),
  get: (id: string) =>
    transactionResult<DemoOccurrence | null>(
      'readwrite',
      (store, resolveValue) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const occurrence = parseDemoOccurrence(request.result);
          if (occurrence && isRecord(request.result) && request.result.schemaVersion !== 2)
            store.put(occurrence);
          resolveValue(occurrence);
        };
      },
    ),
  ensure: (occurrence: DemoOccurrence) =>
    transactionResult<DemoOccurrence>('readwrite', (store, resolveValue) => {
      const request = store.get(occurrence.id);
      request.onsuccess = () => {
        const result = parseDemoOccurrence(request.result) ?? occurrence;
        if (!isRecord(request.result) || request.result.schemaVersion !== 2)
          store.put(result);
        resolveValue(result);
      };
    }),
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
  getPricingRecovery: async (occurrenceId: string) =>
    demoBookingTransaction<DemoPricingRecoveryRecord | null>(
      ['pricingRecovery'],
      'readonly',
      (transaction, resolveValue) => {
        const request = transaction.objectStore('pricingRecovery').get(occurrenceId);
        request.onsuccess = () => {
          if (request.result === undefined) {
            resolveValue(null);
            return;
          }
          const parsed = demoPricingRecoveryRecordSchema.safeParse(request.result);
          if (
            !parsed.success ||
            parsed.data.occurrenceId !== occurrenceId ||
            parsed.data.document.occurrenceId !== occurrenceId ||
            parsed.data.document.layoutVersionId !== parsed.data.layoutVersionId ||
            parsed.data.document.catalogRevision !== parsed.data.catalogRevision
          ) {
            resolveValue(null);
            return;
          }
          resolveValue(parsed.data);
        };
      },
    ),
  savePricingRecovery: async (record: DemoPricingRecoveryRecord) => {
    const parsed = demoPricingRecoveryRecordSchema.parse(record);
    if (
      parsed.document.occurrenceId !== parsed.occurrenceId ||
      parsed.document.layoutVersionId !== parsed.layoutVersionId ||
      parsed.document.catalogRevision !== parsed.catalogRevision ||
      parsed.document.revision !== parsed.baseRevision
    ) throw new Error('Контекст черновика цен не совпадает с восстановлением');
    await demoBookingTransaction<void>(['pricingRecovery'], 'readwrite', (transaction, resolveValue) => {
      transaction.objectStore('pricingRecovery').put(parsed);
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
  clear: async () => {
    await demoBookingTransaction<void>(
      ['occurrences', 'pricingAssignments', 'pricingRecovery'],
      'readwrite',
      (transaction, resolveValue) => {
        transaction.objectStore('occurrences').clear();
        transaction.objectStore('pricingAssignments').clear();
        transaction.objectStore('pricingRecovery').clear();
        resolveValue();
      },
    );
    announceChange('*');
  },
};

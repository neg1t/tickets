import type { SeatSelectionItem } from '@hall-platform/seat-view';
import { layoutSnapshotSchema, seatStatusSchema } from '@hall-platform/domain';
import {
  cancelDemoHold,
  confirmDemoHold,
  holdDemoSelection,
  type DemoOccurrence,
} from './demoBooking.js';

const databaseName = 'hall-platform-demo-booking';
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

function readOccurrence(value: unknown): DemoOccurrence | null {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== undefined && value.schemaVersion !== 1)
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
  if (
    !value.holds.every(
      (hold: unknown) =>
        isRecord(hold) &&
        typeof hold.id === 'string' &&
        Number.isFinite(hold.expiresAt) &&
        isSelection(hold.selection),
    )
  )
    return null;
  if (
    !value.orders.every(
      (order: unknown) =>
        isRecord(order) &&
        typeof order.id === 'string' &&
        Number.isFinite(order.confirmedAt) &&
        isSelection(order.selection),
    )
  )
    return null;
  return value as DemoOccurrence;
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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('occurrences', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Хранилище бронирований занято другой вкладкой'));
  });
}

async function transactionResult<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolveValue: (value: T) => void,
    rejectValue: (error: Error) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction('occurrences', mode);
    const store = transaction.objectStore('occurrences');
    let value: T;
    let failure: Error | null = null;
    transaction.oncomplete = () => {
      database.close();
      resolve(value);
    };
    transaction.onabort = () => {
      database.close();
      reject(
        failure ??
          transaction.error ??
          new Error('Локальное бронирование не сохранено'),
      );
    };
    transaction.onerror = () => {
      failure ??= transaction.error;
    };
    try {
      operation(
        store,
        (result) => {
          value = result;
        },
        (error) => {
          failure = error;
          transaction.abort();
        },
      );
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      transaction.abort();
    }
  });
}

export const demoBookingRepository = {
  list: () =>
    transactionResult<DemoOccurrence[]>('readonly', (store, resolveValue) => {
      const request = store.getAll();
      request.onsuccess = () =>
        resolveValue(
          request.result
            .map(readOccurrence)
            .filter((item): item is DemoOccurrence => item !== null),
        );
    }),
  get: (id: string) =>
    transactionResult<DemoOccurrence | null>(
      'readonly',
      (store, resolveValue) => {
        const request = store.get(id);
        request.onsuccess = () => resolveValue(readOccurrence(request.result));
      },
    ),
  ensure: (occurrence: DemoOccurrence) =>
    transactionResult<DemoOccurrence>('readwrite', (store, resolveValue) => {
      const request = store.get(occurrence.id);
      request.onsuccess = () => {
        const result = readOccurrence(request.result) ?? occurrence;
        if (!readOccurrence(request.result))
          store.put({ ...result, schemaVersion: 1 });
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
          const current = readOccurrence(request.result);
          if (!current) {
            rejectValue(new Error('Демо-мероприятие не найдено'));
            return;
          }
          try {
            const next = mutate(current);
            store.put({ ...next, schemaVersion: 1 });
            resolveValue(next);
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
  clear: async () => {
    await transactionResult<void>('readwrite', (store, resolveValue) => {
      store.clear();
      resolveValue();
    });
    announceChange('*');
  },
};

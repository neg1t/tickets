import type { SeatSelectionItem } from '@hall-platform/seat-view';
import {
  cancelDemoHold,
  confirmDemoHold,
  holdDemoSelection,
  type DemoOccurrence,
} from './demoBooking.js';

const databaseName = 'hall-platform-demo-booking';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('occurrences', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
  });
}

export const demoBookingRepository = {
  list: () =>
    transactionResult<DemoOccurrence[]>('readonly', (store, resolveValue) => {
      const request = store.getAll();
      request.onsuccess = () =>
        resolveValue(request.result as DemoOccurrence[]);
    }),
  get: (id: string) =>
    transactionResult<DemoOccurrence | null>(
      'readonly',
      (store, resolveValue) => {
        const request = store.get(id);
        request.onsuccess = () =>
          resolveValue((request.result as DemoOccurrence | undefined) ?? null);
      },
    ),
  ensure: (occurrence: DemoOccurrence) =>
    transactionResult<DemoOccurrence>('readwrite', (store, resolveValue) => {
      const request = store.get(occurrence.id);
      request.onsuccess = () => {
        const result =
          (request.result as DemoOccurrence | undefined) ?? occurrence;
        if (!request.result) store.put(result);
        resolveValue(result);
      };
    }),
  update: (id: string, mutate: (current: DemoOccurrence) => DemoOccurrence) =>
    transactionResult<DemoOccurrence>(
      'readwrite',
      (store, resolveValue, rejectValue) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const current = request.result as DemoOccurrence | undefined;
          if (!current) {
            rejectValue(new Error('Демо-мероприятие не найдено'));
            return;
          }
          try {
            const next = mutate(current);
            store.put(next);
            resolveValue(next);
          } catch (error) {
            rejectValue(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        };
      },
    ),
  hold: (id: string, selection: readonly SeatSelectionItem[]) =>
    demoBookingRepository.update(id, (current) =>
      holdDemoSelection(current, selection),
    ),
  confirm: (id: string, holdId: string) =>
    demoBookingRepository.update(id, (current) =>
      confirmDemoHold(current, holdId),
    ),
  cancel: (id: string, holdId: string) =>
    demoBookingRepository.update(id, (current) =>
      cancelDemoHold(current, holdId),
    ),
  clear: () =>
    transactionResult<void>('readwrite', (store, resolveValue) => {
      store.clear();
      resolveValue();
    }),
};

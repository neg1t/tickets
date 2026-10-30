export const demoBookingDatabaseName = 'hall-platform-demo-booking';

export type DemoBookingStoreName =
  | 'occurrences'
  | 'pricingAssignments'
  | 'pricingRecovery'
  | 'occurrenceEditorMaterials';

const databaseVersion = 3;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(demoBookingDatabaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('occurrences'))
        database.createObjectStore('occurrences', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('pricingAssignments'))
        database.createObjectStore('pricingAssignments', { keyPath: 'occurrenceId' });
      if (!database.objectStoreNames.contains('pricingRecovery'))
        database.createObjectStore('pricingRecovery', { keyPath: 'occurrenceId' });
      if (!database.objectStoreNames.contains('occurrenceEditorMaterials'))
        database.createObjectStore('occurrenceEditorMaterials', { keyPath: 'occurrenceId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Хранилище бронирований занято другой вкладкой'));
  });
}

export function demoBookingTransaction<T>(
  storeNames: readonly DemoBookingStoreName[],
  mode: IDBTransactionMode,
  operation: (
    transaction: IDBTransaction,
    resolveValue: (value: T) => void,
    rejectValue: (error: Error) => void,
  ) => void,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction([...storeNames], mode);
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
            transaction,
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
      }),
  );
}

import { HallStorageError } from './storageCodec.js';

export const DATABASE_VERSION = 2;

export function storageFailure(error: unknown): HallStorageError {
  if (error instanceof HallStorageError) return error;
  const name =
    error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : '';
  const code = name === 'QuotaExceededError' ? 'quota' : 'transaction';
  return new HallStorageError(
    code,
    error instanceof Error ? error.message : 'IndexedDB operation failed',
    { cause: error },
  );
}

export function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, DATABASE_VERSION);
    } catch (error) {
      reject(storageFailure(error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('halls'))
        database.createObjectStore('halls', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('versions')) {
        const versions = database.createObjectStore('versions', {
          keyPath: 'versionId',
        });
        versions.createIndex('hallId', 'hallId');
      }
      if (!database.objectStoreNames.contains('assets'))
        database.createObjectStore('assets', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('recovery'))
        database.createObjectStore('recovery', { keyPath: 'hallId' });
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        reject(storageFailure(request.error));
      }
    };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(
          new HallStorageError(
            'blocked',
            'IndexedDB upgrade is blocked by another tab',
          ),
        );
      }
    };
  });
}

export function createDatabaseAccessor(
  name: string,
): () => Promise<IDBDatabase> {
  let pending: Promise<IDBDatabase> | null = null;
  return () => {
    if (!pending) {
      pending = openDatabase(name)
        .then((database) => {
          database.onversionchange = () => {
            database.close();
            pending = null;
          };
          return database;
        })
        .catch((error: unknown) => {
          pending = null;
          throw error;
        });
    }
    return pending;
  };
}

export function transact<T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (
    transaction: IDBTransaction,
    setResult: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(stores, mode);
    } catch (error) {
      reject(storageFailure(error));
      return;
    }
    let result: T;
    let failure: unknown;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(storageFailure(transaction.error));
    transaction.onabort = () =>
      reject(storageFailure(failure ?? transaction.error));
    try {
      work(
        transaction,
        (value) => {
          result = value;
        },
        (error) => {
          failure = error;
          transaction.abort();
        },
      );
    } catch (error) {
      failure = error;
      transaction.abort();
      reject(storageFailure(error));
    }
  });
}

export function readStore<T>(
  database: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return transact(database, [store], 'readonly', (transaction, done) => {
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = () => done(request.result as T | undefined);
  });
}

export function readAllStore<T>(
  database: IDBDatabase,
  store: string,
): Promise<T[]> {
  return transact(database, [store], 'readonly', (transaction, done) => {
    const request = transaction.objectStore(store).getAll();
    request.onsuccess = () => done(request.result as T[]);
  });
}

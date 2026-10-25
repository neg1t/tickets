import {
  parseHallLayoutDraft,
  type HallLayoutDraft,
} from '@hall-platform/domain';
import {
  decodeStoredDraft,
  encodeStoredDraft,
  HallStorageError,
  validateStoredDraft,
  type StoredDraft,
} from './storageCodec.js';
import {
  createDatabaseAccessor,
  readAllStore,
  readStore,
  transact,
} from './storageDatabase.js';

export type RecoveryDraft = {
  hallId: string;
  draft: HallLayoutDraft;
  baseRevision: number;
  updatedAt: string;
};
type StoredRecovery = Omit<RecoveryDraft, 'draft'> & { draft: StoredDraft };

export interface RecoveryRepository {
  save(draft: HallLayoutDraft, baseRevision: number): Promise<RecoveryDraft>;
  read(hallId: string): Promise<RecoveryDraft | null>;
  list(): Promise<RecoveryDraft[]>;
  delete(hallId: string): Promise<void>;
  clear(): Promise<void>;
}

export function validateStoredRecovery(value: unknown): StoredRecovery {
  if (typeof value !== 'object' || value === null) {
    throw new HallStorageError('corrupt', 'Invalid recovery record');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.hallId !== 'string' ||
    !record.hallId ||
    !Number.isSafeInteger(record.baseRevision) ||
    (record.baseRevision as number) < 0 ||
    typeof record.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(record.updatedAt))
  ) {
    throw new HallStorageError('corrupt', 'Invalid recovery metadata');
  }
  const draft = validateStoredDraft(record.draft);
  if (draft.snapshot.id !== record.hallId) {
    throw new HallStorageError(
      'corrupt',
      'Recovery hall ID differs from draft ID',
    );
  }
  return { ...(value as StoredRecovery), draft };
}

export function createRecoveryRepository(
  name = 'hall-platform-studio',
): RecoveryRepository {
  const database = createDatabaseAccessor(name);
  const hydrate = async (value: unknown): Promise<RecoveryDraft> => {
    const record = validateStoredRecovery(value);
    const draft = await decodeStoredDraft(
      record.draft,
      async (key) =>
        (
          await readStore<{ key: string; blob: Blob }>(
            await database(),
            'assets',
            key,
          )
        )?.blob,
    );
    return { ...record, draft };
  };
  return {
    async save(value, baseRevision) {
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
        throw new HallStorageError('corrupt', 'Invalid base revision');
      }
      const draft = parseHallLayoutDraft(value);
      const encoded = await encodeStoredDraft(draft);
      const record: RecoveryDraft = {
        hallId: draft.snapshot.id,
        draft,
        baseRevision,
        updatedAt: new Date().toISOString(),
      };
      return transact(
        await database(),
        ['recovery', 'assets'],
        'readwrite',
        (transaction, done) => {
          for (const entry of encoded.blobs)
            transaction.objectStore('assets').put(entry);
          transaction
            .objectStore('recovery')
            .put({ ...record, draft: encoded.draft });
          done(record);
        },
      );
    },
    async read(hallId) {
      const value = await readStore<unknown>(
        await database(),
        'recovery',
        hallId,
      );
      return value ? hydrate(value) : null;
    },
    async list() {
      const values = await readAllStore<unknown>(await database(), 'recovery');
      const recovered: RecoveryDraft[] = [];
      for (const value of values) {
        try {
          recovered.push(await hydrate(value));
        } catch {
          /* Keep damaged recovery records for manual recovery. */
        }
      }
      return recovered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async delete(hallId) {
      return transact(
        await database(),
        ['recovery'],
        'readwrite',
        (transaction, done) => {
          transaction.objectStore('recovery').delete(hallId);
          done(undefined);
        },
      );
    },
    async clear() {
      return transact(
        await database(),
        ['recovery'],
        'readwrite',
        (transaction, done) => {
          transaction.objectStore('recovery').clear();
          done(undefined);
        },
      );
    },
  };
}

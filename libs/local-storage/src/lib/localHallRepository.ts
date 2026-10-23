import {
  backgroundIdSchema,
  decorationIdSchema,
  floorIdSchema,
  layoutVersionIdSchema,
  rowIdSchema,
  seatIdSchema,
  tableIdSchema,
  zoneIdSchema,
  parseHallLayoutDraft,
  type HallLayoutDraft,
} from '@hall-platform/domain';

export type StoredHall = Readonly<{
  id: string;
  draft: HallLayoutDraft;
  updatedAt: string;
  revision: number;
  publishedVersionNumber: number;
}>;

export type HallSummary = Readonly<{
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  publishedVersionNumber: number;
  seats: number;
  zones: number;
}>;

export type PublishedHallVersion = Readonly<{
  versionId: string;
  hallId: string;
  versionNumber: number;
  publishedAt: string;
  layout: HallLayoutDraft;
}>;

export interface LocalHallRepository {
  list(): Promise<HallSummary[]>;
  get(id: string): Promise<HallLayoutDraft | null>;
  read(id: string): Promise<StoredHall | null>;
  save(layout: HallLayoutDraft, expectedRevision?: number): Promise<StoredHall>;
  delete(id: string): Promise<void>;
  publish(id: string): Promise<PublishedHallVersion>;
  publishDraft(
    layout: HallLayoutDraft,
    expectedRevision: number,
  ): Promise<{ record: StoredHall; published: PublishedHallVersion }>;
  listPublished(id: string): Promise<PublishedHallVersion[]>;
  getPublished(versionId: string): Promise<PublishedHallVersion | null>;
  clear(): Promise<void>;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function duplicateHallDraft(source: HallLayoutDraft): HallLayoutDraft {
  const original = parseHallLayoutDraft(source);
  const floorIds = new Map<string, ReturnType<typeof floorIdSchema.parse>>(
    original.snapshot.floors.map((floor) => [
      floor.id,
      floorIdSchema.parse(newId('floor')),
    ]),
  );
  const zoneIds = new Map<string, ReturnType<typeof zoneIdSchema.parse>>(
    original.snapshot.zones.map((zone) => [
      zone.id,
      zoneIdSchema.parse(newId('zone')),
    ]),
  );
  const rowIds = new Map<string, ReturnType<typeof rowIdSchema.parse>>(
    original.snapshot.rows.map((row) => [
      row.id,
      rowIdSchema.parse(newId('row')),
    ]),
  );
  const tableIds = new Map<string, ReturnType<typeof tableIdSchema.parse>>(
    original.snapshot.tables.map((table) => [
      table.id,
      tableIdSchema.parse(newId('table')),
    ]),
  );
  const versionId = layoutVersionIdSchema.parse(newId('version'));
  const floorId = (id: string) => {
    const next = floorIds.get(id);
    if (!next) throw new Error(`Unknown floor: ${id}`);
    return next;
  };
  const zoneId = (id: string | undefined) => (id ? zoneIds.get(id) : undefined);

  return parseHallLayoutDraft({
    ...original,
    hallName: `${original.hallName} (копия)`,
    snapshot: {
      ...original.snapshot,
      id: newId('snapshot'),
      layoutVersionId: versionId,
      floors: original.snapshot.floors.map((floor) => ({
        ...floor,
        id: floorId(floor.id),
        layoutVersionId: versionId,
      })),
      zones: original.snapshot.zones.map((zone) => ({
        ...zone,
        id: zoneIds.get(zone.id),
        floorId: floorId(zone.floorId),
      })),
      rows: original.snapshot.rows.map((row) => ({
        ...row,
        id: rowIds.get(row.id),
        floorId: floorId(row.floorId),
        zoneId: zoneId(row.zoneId),
      })),
      tables: original.snapshot.tables.map((table) => ({
        ...table,
        id: tableIds.get(table.id),
        floorId: floorId(table.floorId),
        zoneId: zoneId(table.zoneId),
      })),
      seats: original.snapshot.seats.map((seat) => ({
        ...seat,
        id: seatIdSchema.parse(newId('seat')),
        floorId: floorId(seat.floorId),
        zoneId: zoneId(seat.zoneId),
        placement:
          seat.placement.kind === 'row'
            ? { kind: 'row', rowId: rowIds.get(seat.placement.rowId) }
            : seat.placement.kind === 'table'
              ? { kind: 'table', tableId: tableIds.get(seat.placement.tableId) }
              : seat.placement,
      })),
      backgrounds: original.snapshot.backgrounds.map((background) => ({
        ...background,
        id: backgroundIdSchema.parse(newId('background')),
        floorId: floorId(background.floorId),
      })),
      decorations: original.snapshot.decorations.map((decoration) => ({
        ...decoration,
        id: decorationIdSchema.parse(newId('decoration')),
        floorId: floorId(decoration.floorId),
      })),
    },
    zoneBounds: Object.fromEntries(
      Object.entries(original.zoneBounds).map(([id, bounds]) => [
        zoneIds.get(id),
        bounds,
      ]),
    ),
  });
}

export function createPublishedVersion(
  draft: HallLayoutDraft,
  latestVersionNumber: number,
): PublishedHallVersion {
  const versionId = layoutVersionIdSchema.parse(newId('version'));
  return {
    versionId,
    hallId: draft.snapshot.id,
    versionNumber: latestVersionNumber + 1,
    publishedAt: new Date().toISOString(),
    layout: parseHallLayoutDraft({
      ...draft,
      snapshot: {
        ...draft.snapshot,
        id: newId('snapshot'),
        layoutVersionId: versionId,
        floors: draft.snapshot.floors.map((floor) => ({
          ...floor,
          layoutVersionId: versionId,
        })),
      },
    }),
  };
}

function summarize(record: StoredHall): HallSummary {
  return {
    id: record.id,
    name: record.draft.hallName,
    updatedAt: record.updatedAt,
    revision: record.revision,
    publishedVersionNumber: record.publishedVersionNumber,
    seats: record.draft.snapshot.seats.length,
    zones: record.draft.snapshot.zones.length,
  };
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('halls', { keyPath: 'id' });
      const versions = database.createObjectStore('versions', {
        keyPath: 'versionId',
      });
      versions.createIndex('hallId', 'hallId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('IndexedDB is blocked by another tab'));
  });
}

function transact<T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, setResult: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    try {
      work(transaction, (value) => {
        result = value;
      });
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export function createLocalHallRepository(
  name = 'hall-platform-studio',
): LocalHallRepository {
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = () => (databasePromise ??= openDatabase(name));

  const repository: LocalHallRepository = {
    async list() {
      return transact(
        await database(),
        ['halls'],
        'readonly',
        (transaction, done) => {
          const request = transaction.objectStore('halls').getAll();
          request.onsuccess = () =>
            done(
              (request.result as StoredHall[])
                .map(summarize)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            );
        },
      );
    },
    async read(id) {
      return transact(
        await database(),
        ['halls'],
        'readonly',
        (transaction, done) => {
          const request = transaction.objectStore('halls').get(id);
          request.onsuccess = () =>
            done(
              request.result
                ? {
                    ...(request.result as StoredHall),
                    draft: parseHallLayoutDraft(
                      (request.result as StoredHall).draft,
                    ),
                  }
                : null,
            );
        },
      );
    },
    async get(id) {
      return (await repository.read(id))?.draft ?? null;
    },
    async save(layout, expectedRevision) {
      const draft = parseHallLayoutDraft(layout);
      const id = draft.snapshot.id;
      let conflict = false;
      return transact<StoredHall>(
        await database(),
        ['halls', 'versions'],
        'readwrite',
        (transaction, done) => {
          const store = transaction.objectStore('halls');
          const request = store.get(id);
          request.onsuccess = () => {
            const previous = request.result as StoredHall | undefined;
            if (
              expectedRevision !== undefined &&
              (previous?.revision ?? 0) !== expectedRevision
            ) {
              conflict = true;
              transaction.abort();
              return;
            }
            const saveWithVersion = (publishedVersionNumber: number) => {
              const record: StoredHall = {
                id,
                draft,
                updatedAt: new Date().toISOString(),
                revision: (previous?.revision ?? 0) + 1,
                publishedVersionNumber,
              };
              store.put(record);
              done(record);
            };
            if (previous) {
              saveWithVersion(previous.publishedVersionNumber);
            } else {
              const versions = transaction
                .objectStore('versions')
                .index('hallId')
                .getAll(id);
              versions.onsuccess = () =>
                saveWithVersion(
                  Math.max(
                    0,
                    ...(versions.result as PublishedHallVersion[]).map(
                      (version) => version.versionNumber,
                    ),
                  ),
                );
            }
          };
        },
      ).catch((error: unknown) => {
        if (conflict)
          throw new Error(
            'Черновик изменён в другой вкладке. Обновите страницу.',
          );
        throw error;
      });
    },
    async delete(id) {
      return transact(
        await database(),
        ['halls'],
        'readwrite',
        (transaction, done) => {
          transaction.objectStore('halls').delete(id);
          done(undefined);
        },
      );
    },
    async publishDraft(layout, expectedRevision) {
      const draft = parseHallLayoutDraft(layout);
      const id = draft.snapshot.id;
      let conflict = false;
      return transact<{
        record: StoredHall;
        published: PublishedHallVersion;
      }>(
        await database(),
        ['halls', 'versions'],
        'readwrite',
        (transaction, done) => {
          const halls = transaction.objectStore('halls');
          const request = halls.get(id);
          request.onsuccess = () => {
            const previous = request.result as StoredHall | undefined;
            if ((previous?.revision ?? 0) !== expectedRevision) {
              conflict = true;
              transaction.abort();
              return;
            }
            const publishWithVersion = (publishedVersionNumber: number) => {
              const published = createPublishedVersion(
                draft,
                publishedVersionNumber,
              );
              const record: StoredHall = {
                id,
                draft,
                updatedAt: new Date().toISOString(),
                revision: expectedRevision + 1,
                publishedVersionNumber: published.versionNumber,
              };
              transaction.objectStore('versions').add(published);
              halls.put(record);
              done({ record, published });
            };
            if (previous) {
              publishWithVersion(previous.publishedVersionNumber);
            } else {
              const versions = transaction
                .objectStore('versions')
                .index('hallId')
                .getAll(id);
              versions.onsuccess = () =>
                publishWithVersion(
                  Math.max(
                    0,
                    ...(versions.result as PublishedHallVersion[]).map(
                      (version) => version.versionNumber,
                    ),
                  ),
                );
            }
          };
        },
      ).catch((error: unknown) => {
        if (conflict)
          throw new Error(
            'Черновик изменён в другой вкладке. Обновите страницу.',
          );
        throw error;
      });
    },
    async publish(id) {
      return transact(
        await database(),
        ['halls', 'versions'],
        'readwrite',
        (transaction, done) => {
          const halls = transaction.objectStore('halls');
          const request = halls.get(id);
          request.onsuccess = () => {
            const record = request.result as StoredHall | undefined;
            if (!record) {
              transaction.abort();
              return;
            }
            const published = createPublishedVersion(
              record.draft,
              record.publishedVersionNumber,
            );
            transaction.objectStore('versions').add(published);
            halls.put({
              ...record,
              publishedVersionNumber: published.versionNumber,
            });
            done(published);
          };
        },
      );
    },
    async listPublished(id) {
      return transact(
        await database(),
        ['versions'],
        'readonly',
        (transaction, done) => {
          const request = transaction
            .objectStore('versions')
            .index('hallId')
            .getAll(id);
          request.onsuccess = () =>
            done(
              (request.result as PublishedHallVersion[])
                .map((version) => ({
                  ...version,
                  layout: parseHallLayoutDraft(version.layout),
                }))
                .sort((a, b) => b.versionNumber - a.versionNumber),
            );
        },
      );
    },
    async getPublished(versionId) {
      return transact(
        await database(),
        ['versions'],
        'readonly',
        (transaction, done) => {
          const request = transaction.objectStore('versions').get(versionId);
          request.onsuccess = () => {
            const version = request.result as PublishedHallVersion | undefined;
            done(
              version
                ? { ...version, layout: parseHallLayoutDraft(version.layout) }
                : null,
            );
          };
        },
      );
    },
    async clear() {
      return transact(
        await database(),
        ['halls', 'versions'],
        'readwrite',
        (transaction, done) => {
          transaction.objectStore('halls').clear();
          transaction.objectStore('versions').clear();
          done(undefined);
        },
      );
    },
  };
  return repository;
}

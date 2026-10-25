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
import { decodePdfDataUrl, inspectPdfBytes } from '@hall-platform/pdf';
import {
  collectRetainedAssetKeys,
  decodeStoredDraft,
  encodeStoredDraft,
  HallStorageError,
  validateStoredDraft,
  validateStoredHall,
  type StoredDraft,
  type StoredHallRecord,
} from './storageCodec.js';
import {
  createDatabaseAccessor,
  readAllStore,
  readStore,
  transact,
} from './storageDatabase.js';

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

export type HallExportPackage = Readonly<{
  format: 'hall-platform-package';
  schemaVersion: 1;
  hall: StoredHall;
  publishedVersions: PublishedHallVersion[];
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
  exportHallPackage(id: string): Promise<HallExportPackage>;
  importHallPackage(
    value: unknown,
    options?: { replace?: boolean; signal?: AbortSignal },
  ): Promise<StoredHall>;
  collectGarbage(): Promise<number>;
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

type StoredVersion = Omit<PublishedHallVersion, 'layout'> & {
  layout: StoredDraft;
};

export function parseHallExportPackage(value: unknown): HallExportPackage {
  if (typeof value !== 'object' || value === null) {
    throw new HallStorageError('corrupt', 'Invalid hall package');
  }
  const packageValue = value as Record<string, unknown>;
  if (
    packageValue.format !== 'hall-platform-package' ||
    packageValue.schemaVersion !== 1 ||
    !Array.isArray(packageValue.publishedVersions)
  ) {
    throw new HallStorageError(
      'unsupported',
      'Unsupported hall package format',
    );
  }
  const hall = validateStoredHall(packageValue.hall);
  const draft = parseHallLayoutDraft(hall.draft);
  const versions = packageValue.publishedVersions.map((item) => {
    const version = validateStoredVersion(item);
    const layout = parseHallLayoutDraft(version.layout);
    if (version.hallId !== hall.id) {
      throw new HallStorageError(
        'corrupt',
        'Published version belongs to another hall',
      );
    }
    return { ...version, layout };
  });
  const versionIds = new Set(versions.map((version) => version.versionId));
  if (versionIds.size !== versions.length)
    throw new HallStorageError('corrupt', 'Duplicate published version ID');
  return {
    format: 'hall-platform-package',
    schemaVersion: 1,
    hall: { ...hall, draft },
    publishedVersions: versions,
  };
}

async function validatePackagePdfAssets(
  packageValue: HallExportPackage,
  signal?: AbortSignal,
): Promise<void> {
  const inspected = new Map<string, number>();
  for (const draft of [
    packageValue.hall.draft,
    ...packageValue.publishedVersions.map((version) => version.layout),
  ]) {
    for (const asset of Object.values(draft.assets)) {
      let pages = inspected.get(asset.dataUrl);
      if (pages === undefined) {
        try {
          pages = (
            await inspectPdfBytes(
              decodePdfDataUrl(asset.dataUrl),
              signal ? { signal } : {},
            )
          ).length;
        } catch {
          throw new HallStorageError(
            'corrupt',
            'Package contains an invalid or oversized PDF',
          );
        }
        inspected.set(asset.dataUrl, pages);
      }
      if (pages !== asset.pages.length)
        throw new HallStorageError(
          'corrupt',
          'Package PDF page count differs from its metadata',
        );
    }
  }
}

function validateStoredVersion(value: unknown): StoredVersion {
  if (typeof value !== 'object' || value === null) {
    throw new HallStorageError(
      'corrupt',
      'Stored published version is invalid',
    );
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.versionId !== 'string' ||
    !record.versionId ||
    typeof record.hallId !== 'string' ||
    !record.hallId ||
    !Number.isSafeInteger(record.versionNumber) ||
    (record.versionNumber as number) < 1 ||
    typeof record.publishedAt !== 'string' ||
    Number.isNaN(Date.parse(record.publishedAt))
  ) {
    throw new HallStorageError(
      'corrupt',
      'Stored published version metadata is invalid',
    );
  }
  const layout = validateStoredDraft(record.layout);
  if (layout.snapshot.layoutVersionId !== record.versionId) {
    throw new HallStorageError(
      'corrupt',
      'Published version ID differs from layout ID',
    );
  }
  return { ...(value as StoredVersion), layout };
}

export function createLocalHallRepository(
  name = 'hall-platform-studio',
): LocalHallRepository {
  const database = createDatabaseAccessor(name);
  const loadBlob = async (key: string): Promise<Blob | undefined> =>
    (
      await readStore<{ key: string; blob: Blob }>(
        await database(),
        'assets',
        key,
      )
    )?.blob;
  const hydrateHall = async (value: unknown): Promise<StoredHall> => {
    const record = validateStoredHall(value);
    return {
      ...record,
      draft: await decodeStoredDraft(record.draft, loadBlob),
    };
  };
  const hydrateVersion = async (
    value: unknown,
  ): Promise<PublishedHallVersion> => {
    const version = validateStoredVersion(value);
    return {
      ...version,
      layout: await decodeStoredDraft(version.layout, loadBlob),
    };
  };

  const repository: LocalHallRepository = {
    async list() {
      const records = await readAllStore<unknown>(await database(), 'halls');
      return records
        .flatMap((value) => {
          try {
            const record = validateStoredHall(value);
            return [
              summarize({ ...record, draft: record.draft as HallLayoutDraft }),
            ];
          } catch {
            return [];
          }
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async read(id) {
      const value = await readStore<unknown>(await database(), 'halls', id);
      return value ? hydrateHall(value) : null;
    },
    async get(id) {
      return (await repository.read(id))?.draft ?? null;
    },
    async save(layout, expectedRevision) {
      const draft = parseHallLayoutDraft(layout);
      const encoded = await encodeStoredDraft(draft);
      const id = draft.snapshot.id;
      let conflict = false;
      let invalid: unknown;
      return transact<StoredHall>(
        await database(),
        ['halls', 'versions', 'assets'],
        'readwrite',
        (transaction, done, fail) => {
          const store = transaction.objectStore('halls');
          const request = store.get(id);
          request.onsuccess = () => {
            try {
              let previous: StoredHallRecord | undefined;
              try {
                previous = request.result
                  ? validateStoredHall(request.result)
                  : undefined;
              } catch (error) {
                invalid = error;
                transaction.abort();
                return;
              }
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
                for (const entry of encoded.blobs)
                  transaction.objectStore('assets').put(entry);
                store.put({ ...record, draft: encoded.draft });
                done(record);
              };
              if (previous) {
                saveWithVersion(previous.publishedVersionNumber);
              } else {
                const versions = transaction
                  .objectStore('versions')
                  .index('hallId')
                  .getAll(id);
                versions.onsuccess = () => {
                  try {
                    saveWithVersion(
                      Math.max(
                        0,
                        ...(versions.result as PublishedHallVersion[]).map(
                          (version) => version.versionNumber,
                        ),
                      ),
                    );
                  } catch (error) {
                    fail(error);
                  }
                };
              }
            } catch (error) {
              fail(error);
            }
          };
        },
      ).catch((error: unknown) => {
        if (invalid) throw invalid;
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
      const encoded = await encodeStoredDraft(draft);
      const id = draft.snapshot.id;
      let conflict = false;
      let invalid: unknown;
      return transact<{
        record: StoredHall;
        published: PublishedHallVersion;
      }>(
        await database(),
        ['halls', 'versions', 'assets'],
        'readwrite',
        (transaction, done, fail) => {
          const halls = transaction.objectStore('halls');
          const request = halls.get(id);
          request.onsuccess = () => {
            try {
              let previous: StoredHallRecord | undefined;
              try {
                previous = request.result
                  ? validateStoredHall(request.result)
                  : undefined;
              } catch (error) {
                invalid = error;
                transaction.abort();
                return;
              }
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
                for (const entry of encoded.blobs)
                  transaction.objectStore('assets').put(entry);
                transaction.objectStore('versions').add({
                  ...published,
                  layout: {
                    ...encoded.draft,
                    snapshot: published.layout.snapshot,
                  },
                });
                halls.put({ ...record, draft: encoded.draft });
                done({ record, published });
              };
              if (previous) {
                publishWithVersion(previous.publishedVersionNumber);
              } else {
                const versions = transaction
                  .objectStore('versions')
                  .index('hallId')
                  .getAll(id);
                versions.onsuccess = () => {
                  try {
                    publishWithVersion(
                      Math.max(
                        0,
                        ...(versions.result as PublishedHallVersion[]).map(
                          (version) => version.versionNumber,
                        ),
                      ),
                    );
                  } catch (error) {
                    fail(error);
                  }
                };
              }
            } catch (error) {
              fail(error);
            }
          };
        },
      ).catch((error: unknown) => {
        if (invalid) throw invalid;
        if (conflict)
          throw new Error(
            'Черновик изменён в другой вкладке. Обновите страницу.',
          );
        throw error;
      });
    },
    async publish(id) {
      const current = await repository.read(id);
      if (!current)
        throw new HallStorageError('missing', `Hall ${id} does not exist`);
      const published = createPublishedVersion(
        current.draft,
        current.publishedVersionNumber,
      );
      const encoded = await encodeStoredDraft(published.layout);
      let conflict = false;
      return transact<PublishedHallVersion>(
        await database(),
        ['halls', 'versions', 'assets'],
        'readwrite',
        (transaction, done, fail) => {
          const halls = transaction.objectStore('halls');
          const request = halls.get(id);
          request.onsuccess = () => {
            try {
              const record = request.result as StoredHallRecord | undefined;
              if (
                !record ||
                record.revision !== current.revision ||
                record.publishedVersionNumber !== current.publishedVersionNumber
              ) {
                conflict = true;
                transaction.abort();
                return;
              }
              for (const entry of encoded.blobs)
                transaction.objectStore('assets').put(entry);
              transaction
                .objectStore('versions')
                .add({ ...published, layout: encoded.draft });
              halls.put({
                ...record,
                publishedVersionNumber: published.versionNumber,
              });
              done(published);
            } catch (error) {
              fail(error);
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
    async listPublished(id) {
      const stored = await transact<unknown[]>(
        await database(),
        ['versions'],
        'readonly',
        (transaction, done) => {
          const request = transaction
            .objectStore('versions')
            .index('hallId')
            .getAll(id);
          request.onsuccess = () => done(request.result as unknown[]);
        },
      );
      const versions: PublishedHallVersion[] = [];
      for (const value of stored) {
        try {
          versions.push(await hydrateVersion(value));
        } catch {
          /* Preserve damaged records for manual recovery. */
        }
      }
      return versions.sort((a, b) => b.versionNumber - a.versionNumber);
    },
    async getPublished(versionId) {
      const value = await readStore<unknown>(
        await database(),
        'versions',
        versionId,
      );
      return value ? hydrateVersion(value) : null;
    },
    async exportHallPackage(id) {
      const hall = await repository.read(id);
      if (!hall)
        throw new HallStorageError('missing', `Hall ${id} does not exist`);
      const stored = await transact<unknown[]>(
        await database(),
        ['versions'],
        'readonly',
        (transaction, done) => {
          const request = transaction
            .objectStore('versions')
            .index('hallId')
            .getAll(id);
          request.onsuccess = () => done(request.result as unknown[]);
        },
      );
      const publishedVersions = await Promise.all(stored.map(hydrateVersion));
      return {
        format: 'hall-platform-package',
        schemaVersion: 1,
        hall,
        publishedVersions,
      };
    },
    async importHallPackage(value, options) {
      const packageValue = parseHallExportPackage(value);
      await validatePackagePdfAssets(packageValue, options?.signal);
      if (options?.signal?.aborted)
        throw new DOMException('Import cancelled', 'AbortError');
      const encodedHall = await encodeStoredDraft(packageValue.hall.draft);
      const encodedVersions = await Promise.all(
        packageValue.publishedVersions.map(async (version) => ({
          version,
          encoded: await encodeStoredDraft(version.layout),
        })),
      );
      let exists = false;
      const result = await transact<StoredHall>(
        await database(),
        ['halls', 'versions', 'assets'],
        'readwrite',
        (transaction, done, fail) => {
          const abort = () => {
            try {
              transaction.abort();
            } catch {
              /* already completed */
            }
          };
          if (options?.signal?.aborted) {
            fail(new DOMException('Import cancelled', 'AbortError'));
            return;
          }
          options?.signal?.addEventListener('abort', abort, { once: true });
          const detach = () =>
            options?.signal?.removeEventListener('abort', abort);
          transaction.addEventListener('complete', detach, { once: true });
          transaction.addEventListener('abort', detach, { once: true });
          const halls = transaction.objectStore('halls');
          const request = halls.get(packageValue.hall.id);
          request.onsuccess = () => {
            try {
              if (request.result && !options?.replace) {
                exists = true;
                transaction.abort();
                return;
              }
              const putPackage = () => {
                if (options?.signal?.aborted) {
                  fail(new DOMException('Import cancelled', 'AbortError'));
                  return;
                }
                const assets = transaction.objectStore('assets');
                for (const entry of encodedHall.blobs) assets.put(entry);
                halls.put({ ...packageValue.hall, draft: encodedHall.draft });
                const versions = transaction.objectStore('versions');
                for (const { version, encoded } of encodedVersions) {
                  for (const entry of encoded.blobs) assets.put(entry);
                  versions.put({ ...version, layout: encoded.draft });
                }
                done(packageValue.hall);
              };
              const versions = transaction.objectStore('versions');
              const commitPackage = () => {
                if (request.result && options?.replace) {
                  const oldKeys = versions
                    .index('hallId')
                    .getAllKeys(packageValue.hall.id);
                  oldKeys.onsuccess = () => {
                    try {
                      for (const key of oldKeys.result) versions.delete(key);
                      putPackage();
                    } catch (error) {
                      fail(error);
                    }
                  };
                } else {
                  putPackage();
                }
              };
              if (encodedVersions.length === 0) {
                commitPackage();
                return;
              }
              let unchecked = encodedVersions.length;
              for (const { version } of encodedVersions) {
                const existingVersion = versions.get(version.versionId);
                existingVersion.onsuccess = () => {
                  try {
                    const existing = existingVersion.result as
                      StoredVersion | undefined;
                    if (
                      existing &&
                      (!options?.replace ||
                        existing.hallId !== packageValue.hall.id)
                    ) {
                      fail(
                        new HallStorageError(
                          'conflict',
                          `Published version ${version.versionId} already exists`,
                        ),
                      );
                      return;
                    }
                    unchecked -= 1;
                    if (unchecked === 0) commitPackage();
                  } catch (error) {
                    fail(error);
                  }
                };
              }
            } catch (error) {
              fail(error);
            }
          };
        },
      ).catch((error: unknown) => {
        if (exists)
          throw new HallStorageError(
            'conflict',
            `Hall ${packageValue.hall.id} already exists`,
          );
        throw error;
      });
      return result;
    },
    async collectGarbage() {
      return transact<number>(
        await database(),
        ['halls', 'versions', 'recovery', 'assets'],
        'readwrite',
        (transaction, done) => {
          const hallsRequest = transaction.objectStore('halls').getAll();
          const versionsRequest = transaction.objectStore('versions').getAll();
          const recoveryRequest = transaction.objectStore('recovery').getAll();
          const assetKeysRequest = transaction
            .objectStore('assets')
            .getAllKeys();
          let ready = 0;
          const finish = () => {
            if (++ready !== 4) return;
            try {
              const halls = (hallsRequest.result as unknown[]).map(
                validateStoredHall,
              );
              const versions = (versionsRequest.result as unknown[]).map(
                validateStoredVersion,
              );
              const recoveries = (recoveryRequest.result as unknown[]).map(
                (value) => {
                  if (typeof value !== 'object' || value === null)
                    throw new HallStorageError(
                      'corrupt',
                      'Invalid recovery record',
                    );
                  const draft = validateStoredDraft(
                    (value as { draft?: unknown }).draft,
                  );
                  return { draft };
                },
              );
              const retained = collectRetainedAssetKeys(
                halls,
                versions,
                recoveries,
              );
              const unreferenced = assetKeysRequest.result.filter(
                (key) => !retained.has(String(key)),
              );
              for (const key of unreferenced)
                transaction.objectStore('assets').delete(key);
              done(unreferenced.length);
            } catch {
              // Damaged records may still contain valid references; never collect while any are unreadable.
              transaction.abort();
            }
          };
          hallsRequest.onsuccess = finish;
          versionsRequest.onsuccess = finish;
          recoveryRequest.onsuccess = finish;
          assetKeysRequest.onsuccess = finish;
        },
      );
    },
    async clear() {
      return transact(
        await database(),
        ['halls', 'versions', 'recovery', 'assets'],
        'readwrite',
        (transaction, done) => {
          transaction.objectStore('halls').clear();
          transaction.objectStore('versions').clear();
          transaction.objectStore('recovery').clear();
          transaction.objectStore('assets').clear();
          done(undefined);
        },
      );
    },
  };
  return repository;
}

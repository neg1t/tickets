import { createEffect, createEvent, createStore, sample } from 'effector';
import {
  layoutDocumentSchema,
  layoutSnapshotSchema,
} from '@hall-platform/domain';
import {
  createPerformanceHallDraft as createPerformanceHallFixtureDraft,
  getPerformanceHallId,
  PERFORMANCE_HALL_SEAT_COUNT,
  type PerformanceHallSize,
} from '@hall-platform/fixtures';
import arena from '@hall-platform/fixtures/arena.json';
import banquetHall from '@hall-platform/fixtures/banquet-hall.json';
import operaHall from '@hall-platform/fixtures/opera-hall.json';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import {
  assertDraftImportLimits,
  assertImportBytes,
  assertImportFile,
  createDraftFromSnapshot,
  createEmptyDraft,
  parseHallLayoutDraft,
  validateLayout,
  type HallLayoutDraft,
} from '@hall-platform/hall-editor';
import {
  createLocalHallRepository,
  duplicateHallDraft,
  HallStorageError,
  type HallSummary,
  type HallExportPackage,
  type PublishedHallVersion,
  type PublishedVersionMetadata,
  type StoredHall,
} from '@hall-platform/local-storage';
import type { SeatSelectionItem } from '@hall-platform/seat-view';
import {
  createDemoOccurrence,
  findOwnActiveHold,
  preferLatestDemoOccurrence,
  type DemoOccurrence,
  type DemoOrder,
} from './demoBooking.js';
import {
  demoBookingRepository,
  getDemoOwnerId,
  subscribeToDemoChanges,
} from './demoBookingRepository.js';

const repository = createLocalHallRepository();
const activeHallKey = 'hall-platform-active-hall';
const activeBuyerKey = 'hall-platform-active-demo-occurrence';
function markPerformance(name: string): void {
  if (typeof performance !== 'undefined') performance.mark(name);
}
function measurePerformance(name: string, start: string, end: string): void {
  if (typeof performance !== 'undefined') performance.measure(name, start, end);
}
type BrowserStorageKind = 'local' | 'session';
function browserStorage(kind: BrowserStorageKind): Storage {
  return kind === 'local' ? localStorage : sessionStorage;
}
function readBrowserStorage(
  kind: BrowserStorageKind,
  key: string,
): string | null {
  try {
    return browserStorage(kind).getItem(key);
  } catch {
    return null;
  }
}
function writeBrowserStorage(
  kind: BrowserStorageKind,
  key: string,
  value: string,
): void {
  try {
    browserStorage(kind).setItem(key, value);
  } catch {
    /* storage access is optional */
  }
}
function removeBrowserStorage(kind: BrowserStorageKind, key: string): void {
  try {
    browserStorage(kind).removeItem(key);
  } catch {
    /* storage access is optional */
  }
}
const fixtures = [smallTheater, operaHall, arena, banquetHall].map(
  (fixture) => {
    const document = layoutDocumentSchema.parse(fixture.document);
    return createDraftFromSnapshot(document.hall.name, document.snapshot);
  },
);
const sampleDraft = fixtures[0];
if (!sampleDraft) throw new Error('Studio needs at least one fixture');

type OpenedHall = {
  record: StoredHall;
  catalog?: HallSummary[];
  versions?: PublishedVersionMetadata[];
  openSequence: number;
};
type HallMetadataResult = {
  openSequence: number;
  hallId: string;
  catalog: HallSummary[];
  versions: PublishedVersionMetadata[];
};
let nextOpenSequence = 0;
let activeOpenSequence = 0;
const pendingOpenMetadata = new Map<number, HallMetadataResult>();
const pendingOpenMetadataFailures = new Map<number, unknown>();

function publishOpenMetadata(result: HallMetadataResult): void {
  if (result.openSequence === activeOpenSequence) {
    pendingOpenMetadataFailures.delete(result.openSequence);
    hallMetadataLoaded(result);
    return;
  }
  if (result.openSequence < activeOpenSequence) return;
  pendingOpenMetadata.set(result.openSequence, result);
  while (pendingOpenMetadata.size > 8) {
    const oldest = pendingOpenMetadata.keys().next().value;
    if (oldest === undefined) break;
    pendingOpenMetadata.delete(oldest);
  }
}

function publishOpenMetadataFailure(
  openSequence: number,
  error: unknown,
): void {
  if (openSequence === activeOpenSequence) {
    hallMetadataFailed({ openSequence, error });
    return;
  }
  if (openSequence < activeOpenSequence) return;
  pendingOpenMetadataFailures.set(openSequence, error);
}

function acceptOpenSequence(result: OpenedHall): void {
  activeOpenSequence = result.openSequence;
  for (const sequence of pendingOpenMetadata.keys()) {
    if (sequence < activeOpenSequence) pendingOpenMetadata.delete(sequence);
  }
  const metadata = pendingOpenMetadata.get(activeOpenSequence);
  if (metadata) {
    pendingOpenMetadata.delete(activeOpenSequence);
    hallMetadataLoaded(metadata);
  }
  const failure = pendingOpenMetadataFailures.get(activeOpenSequence);
  if (pendingOpenMetadataFailures.has(activeOpenSequence)) {
    pendingOpenMetadataFailures.delete(activeOpenSequence);
    hallMetadataFailed({ openSequence: activeOpenSequence, error: failure });
  }
  for (const sequence of pendingOpenMetadataFailures.keys()) {
    if (sequence < activeOpenSequence)
      pendingOpenMetadataFailures.delete(sequence);
  }
}

const hallMetadataLoaded = createEvent<HallMetadataResult>();
const hallMetadataFailed = createEvent<{
  openSequence: number;
  error: unknown;
}>();

async function seedFixtures(): Promise<void> {
  for (const draft of fixtures) {
    let exists: HallLayoutDraft | null;
    try {
      exists = await repository.get(draft.snapshot.id);
    } catch (error) {
      if (
        error instanceof HallStorageError &&
        (error.code === 'corrupt' || error.code === 'unsupported')
      )
        continue;
      throw error;
    }
    if (!exists) {
      await repository.publishDraft(draft, 0);
    }
  }
}

async function openStoredHall(
  id: string,
  existingRecord?: StoredHall | null,
): Promise<OpenedHall> {
  const openSequence = ++nextOpenSequence;
  markPerformance('hall:open:start');
  markPerformance('hall:open:record:start');
  const record = existingRecord ?? (await repository.read(id));
  markPerformance('hall:open:record:end');
  measurePerformance(
    'hall:open:record',
    'hall:open:record:start',
    'hall:open:record:end',
  );
  if (!record) throw new Error('Зал не найден в локальном хранилище');
  markPerformance('hall:open:end');
  measurePerformance('hall:open', 'hall:open:start', 'hall:open:end');
  void Promise.all([
    (async () => {
      markPerformance('hall:open:catalog:start');
      const catalog = await repository.list();
      markPerformance('hall:open:catalog:end');
      measurePerformance(
        'hall:open:catalog',
        'hall:open:catalog:start',
        'hall:open:catalog:end',
      );
      return catalog;
    })(),
    (async () => {
      markPerformance('hall:open:version-metadata:start');
      const versions = await repository.listPublishedMetadata(id);
      markPerformance('hall:open:version-metadata:end');
      measurePerformance(
        'hall:open:version-metadata',
        'hall:open:version-metadata:start',
        'hall:open:version-metadata:end',
      );
      return versions;
    })(),
  ])
    .then(([catalog, versions]) =>
      publishOpenMetadata({ openSequence, hallId: id, catalog, versions }),
    )
    .catch((error: unknown) => publishOpenMetadataFailure(openSequence, error));
  return { record, openSequence };
}

let initialLoad: Promise<OpenedHall> | null = null;
export const initializeFx = createEffect(() => {
  initialLoad ??= (async () => {
    await seedFixtures();
    const preferred = readBrowserStorage('local', activeHallKey);
    if (preferred) {
      try {
        const preferredRecord = await repository.read(preferred);
        if (preferredRecord) return openStoredHall(preferred, preferredRecord);
      } catch (error) {
        if (
          !(error instanceof HallStorageError) ||
          (error.code !== 'corrupt' && error.code !== 'unsupported')
        )
          throw error;
      }
    }
    return openStoredHall(sampleDraft.snapshot.id);
  })().catch((error: unknown) => {
    initialLoad = null;
    throw error;
  });
  return initialLoad;
});

let latestNavigationRequest = 0;
let documentEpoch = 0;
let navigationController = new AbortController();
function beginNavigation(): number {
  navigationController.abort();
  navigationController = new AbortController();
  return ++latestNavigationRequest;
}
function isCurrentNavigation(requestId: number, epoch: number): boolean {
  return requestId === latestNavigationRequest && epoch === documentEpoch;
}
function requireCurrentNavigation(requestId: number, epoch: number): void {
  if (!isCurrentNavigation(requestId, epoch))
    throw new DOMException(
      'Операция отменена после переключения зала',
      'AbortError',
    );
}
export const openHallFx = createEffect(
  ({ id }: { id: string; requestId: number; epoch: number }) =>
    openStoredHall(id),
);
export function requestOpenHall(id: string): Promise<OpenedHall> {
  return openHallFx({
    id,
    requestId: beginNavigation(),
    epoch: documentEpoch,
  });
}
export const createPerformanceHallFx = createEffect(
  async ({
    epoch,
    requestId,
    seatCount,
  }: {
    epoch: number;
    requestId: number;
    seatCount: PerformanceHallSize;
  }): Promise<OpenedHall> => {
    markPerformance(`hall:fixture:${seatCount}:start`);
    requireCurrentNavigation(requestId, epoch);
    const id = getPerformanceHallId(seatCount);
    markPerformance(`hall:fixture:${seatCount}:lookup:start`);
    const existing = await repository.read(id);
    markPerformance(`hall:fixture:${seatCount}:lookup:end`);
    measurePerformance(
      `hall:fixture:${seatCount}:lookup`,
      `hall:fixture:${seatCount}:lookup:start`,
      `hall:fixture:${seatCount}:lookup:end`,
    );
    requireCurrentNavigation(requestId, epoch);
    if (!existing) {
      markPerformance(`hall:fixture:${seatCount}:generation:start`);
      const draft = createPerformanceHallFixtureDraft(seatCount);
      markPerformance(`hall:fixture:${seatCount}:generation:end`);
      measurePerformance(
        `hall:fixture:${seatCount}:generation`,
        `hall:fixture:${seatCount}:generation:start`,
        `hall:fixture:${seatCount}:generation:end`,
      );
      requireCurrentNavigation(requestId, epoch);
      markPerformance(`hall:fixture:${seatCount}:save:start`);
      await repository.save(draft, 0);
      markPerformance(`hall:fixture:${seatCount}:save:end`);
      measurePerformance(
        `hall:fixture:${seatCount}:save`,
        `hall:fixture:${seatCount}:save:start`,
        `hall:fixture:${seatCount}:save:end`,
      );
    }
    requireCurrentNavigation(requestId, epoch);
    const opened = await openStoredHall(id);
    markPerformance(`hall:fixture:${seatCount}:end`);
    measurePerformance(
      `hall:fixture:${seatCount}`,
      `hall:fixture:${seatCount}:start`,
      `hall:fixture:${seatCount}:end`,
    );
    return opened;
  },
);
export function requestCreatePerformanceHall(
  seatCount: PerformanceHallSize = PERFORMANCE_HALL_SEAT_COUNT,
): Promise<OpenedHall> {
  return createPerformanceHallFx({
    epoch: documentEpoch,
    requestId: beginNavigation(),
    seatCount,
  });
}
const acceptedOpenHall = sample({
  clock: openHallFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedOpenHallFailure = sample({
  clock: openHallFx.fail,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ error }) => error,
});
const acceptedPerformanceHall = sample({
  clock: createPerformanceHallFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
export const sampleHallRequested = createEvent();
sampleHallRequested.watch(() => {
  void requestOpenHall(sampleDraft.snapshot.id).catch(() => undefined);
});
export const newHallRequested = createEvent();
newHallRequested.watch(() => {
  documentEpoch += 1;
  beginNavigation();
});
export const draftChanged = createEvent<HallLayoutDraft>();
export const recoveryRestored = createEvent<{
  draft: HallLayoutDraft;
  baseRevision: number;
}>();
recoveryRestored.watch(() => {
  documentEpoch += 1;
  beginNavigation();
});
export const editorOpened = createEvent();
export const catalogOpened = createEvent();
export const previewOpened = createEvent();
export const demoEventsOpened = createEvent();
for (const event of [
  catalogOpened,
  editorOpened,
  previewOpened,
  demoEventsOpened,
])
  event.watch(beginNavigation);
export const seatSelectionChanged = createEvent<SeatSelectionItem[]>();

export const seedDemoOccurrencesFx = createEffect(async () => {
  for (const fixture of fixtures) {
    let version: PublishedHallVersion | null | undefined;
    try {
      const summary = (
        await repository.listPublishedMetadata(fixture.snapshot.id)
      )[0];
      version = summary
        ? await repository.getPublished(summary.versionId)
        : undefined;
    } catch (error) {
      if (
        error instanceof HallStorageError &&
        (error.code === 'corrupt' || error.code === 'unsupported')
      )
        continue;
      throw error;
    }
    if (version)
      await demoBookingRepository.ensure(
        createDemoOccurrence(
          `demo:${version.versionId}`,
          version.layout,
          fixture.snapshot.id,
        ),
      );
  }
  return demoBookingRepository.list();
});
export const openBuyerFx = createEffect(
  async (summary: PublishedVersionMetadata) => {
    const version = await repository.getPublished(summary.versionId);
    if (!version) throw new Error('Опубликованная версия не найдена');
    return demoBookingRepository.ensure(
      createDemoOccurrence(
        `demo:${version.versionId}`,
        version.layout,
        version.hallId,
      ),
    );
  },
);
export const openDemoEventFx = createEffect(async (id: string) => {
  const occurrence = await demoBookingRepository.get(id);
  if (!occurrence) throw new Error('Демо-мероприятие не найдено');
  return occurrence;
});
export const refreshDemoOccurrenceFx = createEffect(async (id: string) =>
  demoBookingRepository.get(id),
);

export const holdDemoFx = createEffect(
  ({ id, selection }: { id: string; selection: SeatSelectionItem[] }) =>
    demoBookingRepository.hold(id, selection),
);
export const confirmDemoFx = createEffect(
  ({ id, holdId }: { id: string; holdId: string }) =>
    demoBookingRepository.confirm(id, holdId),
);
export const cancelDemoFx = createEffect(
  ({ id, holdId }: { id: string; holdId: string }) =>
    demoBookingRepository.cancel(id, holdId),
);

export const saveDraftFx = createEffect(
  async ({
    draft,
    revision,
  }: {
    draft: HallLayoutDraft;
    revision: number | null;
    epoch?: number;
  }) => {
    const record = await repository.save(draft, revision ?? 0);
    return { record, catalog: await repository.list(), sourceDraft: draft };
  },
);
export function requestSaveDraft(
  draft: HallLayoutDraft,
  revision: number | null,
) {
  return saveDraftFx({ draft, revision, epoch: documentEpoch });
}

export const publishDraftFx = createEffect(
  async ({
    draft,
    revision,
    warningsAcknowledged,
  }: {
    draft: HallLayoutDraft;
    revision: number | null;
    warningsAcknowledged?: boolean;
    epoch?: number;
  }) => {
    const issues = validateLayout(draft);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0)
      throw new Error(`Публикация заблокирована: ${errors[0]?.message}`);
    if (
      issues.some((issue) => issue.severity === 'warning') &&
      !warningsAcknowledged
    )
      throw new Error('Подтвердите публикацию с предупреждениями');
    const { record, published } = await repository.publishDraft(
      draft,
      revision ?? 0,
    );
    return {
      record,
      published,
      catalog: await repository.list(),
      versions: await repository.listPublishedMetadata(record.id),
      sourceDraft: draft,
    };
  },
);
export function requestPublishDraft(
  draft: HallLayoutDraft,
  revision: number | null,
  warningsAcknowledged?: boolean,
) {
  return publishDraftFx({
    draft,
    revision,
    ...(warningsAcknowledged === undefined ? {} : { warningsAcknowledged }),
    epoch: documentEpoch,
  });
}

export const duplicateHallFx = createEffect(
  async ({
    draft,
    epoch,
    requestId,
  }: {
    draft: HallLayoutDraft;
    epoch: number;
    requestId: number;
  }): Promise<OpenedHall> => {
    const copy = duplicateHallDraft(draft);
    requireCurrentNavigation(requestId, epoch);
    await repository.save(copy, 0);
    return openStoredHall(copy.snapshot.id);
  },
);
export function requestDuplicateHall(
  draft: HallLayoutDraft,
): Promise<OpenedHall> {
  return duplicateHallFx({
    draft,
    epoch: documentEpoch,
    requestId: beginNavigation(),
  });
}

export const importDraftFx = createEffect(
  async ({
    file,
    epoch,
    requestId,
  }: {
    file: File;
    epoch: number;
    requestId: number;
  }): Promise<OpenedHall> => {
    markPerformance('hall:import:start');
    assertImportFile(file, 'json');
    markPerformance('hall:import:file-read:start');
    const text = await file.text();
    markPerformance('hall:import:file-read:end');
    measurePerformance(
      'hall:import:file-read',
      'hall:import:file-read:start',
      'hall:import:file-read:end',
    );
    markPerformance('hall:import:parse:start');
    assertImportBytes(new TextEncoder().encode(text).byteLength, 'json');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('Некорректный JSON-файл');
    }
    markPerformance('hall:import:parse:end');
    measurePerformance(
      'hall:import:json-parse',
      'hall:import:parse:start',
      'hall:import:parse:end',
    );
    markPerformance('hall:import:validate:start');
    assertDraftImportLimits(value);
    let parsed: HallLayoutDraft;
    try {
      parsed = parseHallLayoutDraft(value);
    } catch {
      throw new Error('JSON не соответствует схеме зала');
    }
    markPerformance('hall:import:validate:end');
    measurePerformance(
      'hall:import:validation',
      'hall:import:validate:start',
      'hall:import:validate:end',
    );
    const draft = (await repository.get(parsed.snapshot.id))
      ? duplicateHallDraft(parsed)
      : parsed;
    requireCurrentNavigation(requestId, epoch);
    markPerformance('hall:import:save:start');
    await repository.save(draft, 0);
    markPerformance('hall:import:save:end');
    measurePerformance(
      'hall:import:save',
      'hall:import:save:start',
      'hall:import:save:end',
    );
    const opened = await openStoredHall(draft.snapshot.id);
    markPerformance('hall:import:end');
    measurePerformance('hall:import', 'hall:import:start', 'hall:import:end');
    return opened;
  },
);
export function requestImportDraft(file: File): Promise<OpenedHall> {
  return importDraftFx({
    file,
    epoch: documentEpoch,
    requestId: beginNavigation(),
  });
}

export const exportHallPackageFx = createEffect(
  (id: string): Promise<HallExportPackage> => repository.exportHallPackage(id),
);
export const importHallPackageFx = createEffect(
  async ({
    file,
    replace,
    epoch,
    requestId,
    signal,
  }: {
    file: File;
    replace: boolean;
    epoch: number;
    requestId: number;
    signal: AbortSignal;
  }): Promise<OpenedHall> => {
    if (file.size > 64 * 1024 * 1024)
      throw new Error('Пакет зала превышает лимит 64 МБ');
    const text = await file.text();
    if (new TextEncoder().encode(text).byteLength > 64 * 1024 * 1024)
      throw new Error('Пакет зала превышает лимит 64 МБ');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('Некорректный JSON-пакет');
    }
    requireCurrentNavigation(requestId, epoch);
    const imported = await repository.importHallPackage(value, {
      replace,
      signal,
    });
    return openStoredHall(imported.id);
  },
);
export function requestImportHallPackage(
  file: File,
  replace = false,
): Promise<OpenedHall> {
  const requestId = beginNavigation();
  return importHallPackageFx({
    file,
    replace,
    epoch: documentEpoch,
    requestId,
    signal: navigationController.signal,
  });
}

export const deleteHallFx = createEffect(
  async ({
    id,
    epoch,
    requestId,
  }: {
    id: string;
    epoch: number;
    requestId: number;
  }): Promise<OpenedHall> => {
    requireCurrentNavigation(requestId, epoch);
    await repository.delete(id);
    const catalog = await repository.list();
    if (catalog.length === 0) await seedFixtures();
    const remaining = await repository.list();
    return openStoredHall(remaining[0]?.id ?? sampleDraft.snapshot.id);
  },
);
export function requestDeleteHall(id: string): Promise<OpenedHall> {
  return deleteHallFx({
    id,
    epoch: documentEpoch,
    requestId: beginNavigation(),
  });
}

export const restoreFixturesFx = createEffect(
  async ({
    epoch,
    requestId,
  }: {
    epoch: number;
    requestId: number;
  }): Promise<OpenedHall> => {
    for (const draft of fixtures) {
      const existing = await repository.read(draft.snapshot.id);
      requireCurrentNavigation(requestId, epoch);
      await repository.publishDraft(draft, existing?.revision ?? 0);
    }
    return openStoredHall(sampleDraft.snapshot.id);
  },
);
export function requestRestoreFixtures(): Promise<OpenedHall> {
  return restoreFixturesFx({
    epoch: documentEpoch,
    requestId: beginNavigation(),
  });
}

export const resetDemoDataFx = createEffect(
  async ({
    epoch,
    requestId,
  }: {
    epoch: number;
    requestId: number;
  }): Promise<OpenedHall> => {
    requireCurrentNavigation(requestId, epoch);
    await demoBookingRepository.clear();
    requireCurrentNavigation(requestId, epoch);
    await repository.clear();
    requireCurrentNavigation(requestId, epoch);
    await seedFixtures();
    return openStoredHall(sampleDraft.snapshot.id);
  },
);
export function requestResetDemoData(): Promise<OpenedHall> {
  return resetDemoDataFx({
    epoch: documentEpoch,
    requestId: beginNavigation(),
  });
}

export const openPublishedFx = createEffect(
  async ({
    versionId,
  }: {
    versionId: string;
    epoch: number;
    requestId: number;
  }) => {
    const published = await repository.getPublished(versionId);
    if (!published) throw new Error('Опубликованная версия не найдена');
    return published;
  },
);
export function requestOpenPublished(versionId: string) {
  return openPublishedFx({
    versionId,
    epoch: documentEpoch,
    requestId: beginNavigation(),
  });
}

const acceptedSave = sample({
  clock: saveDraftFx.done,
  filter: ({ params }) => params.epoch === documentEpoch,
  fn: ({ result }) => result,
});
const acceptedSaveFailure = sample({
  clock: saveDraftFx.fail,
  filter: ({ params }) => params.epoch === documentEpoch,
  fn: ({ error }) => error,
});
const acceptedPublish = sample({
  clock: publishDraftFx.done,
  filter: ({ params }) => params.epoch === documentEpoch,
  fn: ({ result }) => result,
});
const acceptedPublishFailure = sample({
  clock: publishDraftFx.fail,
  filter: ({ params }) => params.epoch === documentEpoch,
  fn: ({ error }) => error,
});
const acceptedImport = sample({
  clock: importDraftFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedImportFailure = sample({
  clock: importDraftFx.fail,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ error }) => error,
});
const acceptedPackageImport = sample({
  clock: importHallPackageFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedPackageImportFailure = sample({
  clock: importHallPackageFx.fail,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ error }) => error,
});
const acceptedDuplicate = sample({
  clock: duplicateHallFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedDelete = sample({
  clock: deleteHallFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedRestore = sample({
  clock: restoreFixturesFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedReset = sample({
  clock: resetDemoDataFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
const acceptedPublished = sample({
  clock: openPublishedFx.done,
  filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
  fn: ({ result }) => result,
});
sample({
  clock: [acceptedReset, acceptedRestore],
  fn: () => undefined,
  target: seedDemoOccurrencesFx,
});
const acceptedNavigationFailures = [
  sample({
    clock: duplicateHallFx.fail,
    filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
    fn: ({ error }) => error,
  }),
  sample({
    clock: deleteHallFx.fail,
    filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
    fn: ({ error }) => error,
  }),
  sample({
    clock: restoreFixturesFx.fail,
    filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
    fn: ({ error }) => error,
  }),
  sample({
    clock: resetDemoDataFx.fail,
    filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
    fn: ({ error }) => error,
  }),
  sample({
    clock: openPublishedFx.fail,
    filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
    fn: ({ error }) => error,
  }),
  sample({
    clock: createPerformanceHallFx.fail,
    filter: ({ params }) => isCurrentNavigation(params.requestId, params.epoch),
    fn: ({ error }) => error,
  }),
];
for (const event of [
  acceptedOpenHall,
  acceptedPerformanceHall,
  acceptedImport,
  acceptedPackageImport,
  acceptedDuplicate,
  acceptedDelete,
  acceptedRestore,
  acceptedReset,
])
  event.watch(() => {
    documentEpoch += 1;
  });

const opened = [
  initializeFx.doneData,
  acceptedOpenHall,
  acceptedPerformanceHall,
  acceptedDuplicate,
  acceptedImport,
  acceptedPackageImport,
  acceptedDelete,
  acceptedRestore,
  acceptedReset,
];
for (const event of opened) event.watch(acceptOpenSequence);
for (const event of opened)
  event.watch((result) =>
    writeBrowserStorage('local', activeHallKey, result.record.id),
  );
for (const event of [acceptedSave, acceptedPublish])
  event.watch((result) => {
    if ($draft.getState().snapshot.id === result.record.id)
      writeBrowserStorage('local', activeHallKey, result.record.id);
  });

export const $draft = createStore<HallLayoutDraft>(sampleDraft)
  .on(draftChanged, (_, draft) => draft)
  .on(recoveryRestored, (_, recovery) => recovery.draft)
  .on(newHallRequested, () => createEmptyDraft('Новый зал'));
for (const event of opened)
  $draft.on(event, (_, result) => result.record.draft);

export const $catalog = createStore<HallSummary[]>([]);
for (const event of opened)
  $catalog.on(event, (catalog, result) => result.catalog ?? catalog);
$catalog
  .on(acceptedSave, (_, result) => result.catalog)
  .on(acceptedPublish, (_, result) => result.catalog)
  .on(hallMetadataLoaded, (_, result) => result.catalog);

export const $ready = createStore(false).on(initializeFx.doneData, () => true);

export const $revision = createStore<number | null>(null)
  .on(newHallRequested, () => null)
  .on(recoveryRestored, (_, recovery) => recovery.baseRevision)
  .on(acceptedSave, (_, result) => result.record.revision)
  .on(acceptedPublish, (_, result) => result.record.revision);
for (const event of opened)
  $revision.on(event, (_, result) => result.record.revision);

export const $versions = createStore<PublishedVersionMetadata[]>([])
  .on(newHallRequested, () => [])
  .on(acceptedPublish, (_, result) => result.versions)
  .on(hallMetadataLoaded, (_, result) => result.versions);
for (const event of opened)
  $versions.on(event, (_, result) => result.versions ?? []);

export const $mode = createStore<
  'catalog' | 'preview' | 'editor' | 'published' | 'buyer' | 'events'
>('catalog')
  .on(catalogOpened, () => 'catalog')
  .on(editorOpened, () => 'editor')
  .on(previewOpened, () => 'preview')
  .on(newHallRequested, () => 'editor')
  .on(recoveryRestored, () => 'editor')
  .on(demoEventsOpened, () => 'events')
  .on(openBuyerFx.doneData, () => 'buyer')
  .on(openDemoEventFx.doneData, () => 'buyer')
  .on(acceptedPublished, () => 'published');
for (const event of [
  acceptedOpenHall,
  acceptedPerformanceHall,
  acceptedImport,
  acceptedPackageImport,
])
  $mode.on(event, () => 'editor');
for (const event of [
  acceptedDuplicate,
  acceptedDelete,
  acceptedRestore,
  acceptedReset,
])
  $mode.on(event, () => 'catalog');

export const $publishedDraft = createStore<HallLayoutDraft | null>(null)
  .on(acceptedPublished, (_, published) => published.layout)
  .reset(newHallRequested, previewOpened, editorOpened);
for (const event of opened) $publishedDraft.reset(event);

export const $demoEvents = createStore<DemoOccurrence[]>([])
  .on(seedDemoOccurrencesFx.doneData, (_, events) => events)
  .on(openBuyerFx.doneData, (events, occurrence) => [
    ...events.filter((event) => event.id !== occurrence.id),
    occurrence,
  ])
  .on(holdDemoFx.doneData, (events, occurrence) =>
    events.map((event) => (event.id === occurrence.id ? occurrence : event)),
  )
  .on(confirmDemoFx.doneData, (events, occurrence) =>
    events.map((event) => (event.id === occurrence.id ? occurrence : event)),
  )
  .on(cancelDemoFx.doneData, (events, occurrence) =>
    events.map((event) => (event.id === occurrence.id ? occurrence : event)),
  )
  .on(refreshDemoOccurrenceFx.doneData, (events, occurrence) =>
    occurrence
      ? events.map((event) =>
          event.id === occurrence.id
            ? (preferLatestDemoOccurrence(event, occurrence) ?? event)
            : event,
        )
      : events,
  );

export const $buyerOccurrence = createStore<DemoOccurrence | null>(null)
  .on(openBuyerFx.doneData, (_, occurrence) => occurrence)
  .on(openDemoEventFx.doneData, (_, occurrence) => occurrence)
  .on(holdDemoFx.doneData, (current, occurrence) =>
    preferLatestDemoOccurrence(current, occurrence),
  )
  .on(confirmDemoFx.doneData, (current, occurrence) =>
    preferLatestDemoOccurrence(current, occurrence),
  )
  .on(cancelDemoFx.doneData, (current, occurrence) =>
    preferLatestDemoOccurrence(current, occurrence),
  )
  .on(refreshDemoOccurrenceFx.doneData, preferLatestDemoOccurrence)
  .reset(
    newHallRequested,
    catalogOpened,
    demoEventsOpened,
    editorOpened,
    previewOpened,
  );
for (const event of opened) $buyerOccurrence.reset(event);

export const $activeHoldId = createStore<string | null>(null)
  .on(
    holdDemoFx.doneData,
    (_, occurrence) =>
      findOwnActiveHold(occurrence, getDemoOwnerId())?.id ?? null,
  )
  .on(
    openBuyerFx.doneData,
    (_, occurrence) =>
      findOwnActiveHold(occurrence, getDemoOwnerId())?.id ?? null,
  )
  .on(
    openDemoEventFx.doneData,
    (_, occurrence) =>
      findOwnActiveHold(occurrence, getDemoOwnerId())?.id ?? null,
  )
  .on(refreshDemoOccurrenceFx.doneData, (current, occurrence) =>
    occurrence && $buyerOccurrence.getState()?.id === occurrence.id
      ? (findOwnActiveHold(
          preferLatestDemoOccurrence($buyerOccurrence.getState(), occurrence) ??
            occurrence,
          getDemoOwnerId(),
        )?.id ?? null)
      : current,
  )
  .reset(
    confirmDemoFx.doneData,
    cancelDemoFx.doneData,
    catalogOpened,
    demoEventsOpened,
    editorOpened,
    previewOpened,
  );

export const $receipt = createStore<DemoOrder | null>(null)
  .on(
    confirmDemoFx.doneData,
    (_, occurrence) => occurrence.orders.at(-1) ?? null,
  )
  .reset(
    openBuyerFx.doneData,
    openDemoEventFx.doneData,
    catalogOpened,
    demoEventsOpened,
    editorOpened,
    previewOpened,
  );

export const $seatSelection = createStore<SeatSelectionItem[]>([])
  .on(seatSelectionChanged, (_, selection) => selection)
  .reset(
    openBuyerFx.doneData,
    openDemoEventFx.doneData,
    confirmDemoFx.doneData,
    newHallRequested,
    catalogOpened,
    demoEventsOpened,
    editorOpened,
    previewOpened,
  );
for (const event of opened) $seatSelection.reset(event);

export const $bookingError = createStore<string | null>(null);
for (const effect of [
  openBuyerFx,
  openDemoEventFx,
  holdDemoFx,
  confirmDemoFx,
  cancelDemoFx,
]) {
  $bookingError
    .on(effect.failData, (_, error) => error.message)
    .reset(effect.doneData);
}

const draftPersisted = createEvent<boolean>();
sample({
  source: $draft,
  clock: acceptedSave,
  fn: (current, result) => current !== result.sourceDraft,
  target: draftPersisted,
});
sample({
  source: $draft,
  clock: acceptedPublish,
  fn: (current, result) => current !== result.sourceDraft,
  target: draftPersisted,
});

export const $dirty = createStore(false)
  .on(draftChanged, () => true)
  .on(recoveryRestored, () => true)
  .on(newHallRequested, () => true)
  .on(draftPersisted, (_, remainsDirty) => remainsDirty);
for (const event of opened) $dirty.reset(event);

export const $changeCount = createStore(0)
  .on(draftChanged, (count) => count + 1)
  .reset(newHallRequested);
for (const event of opened) $changeCount.reset(event);

export const $notice = createStore('')
  .on(acceptedSave, () => 'Сохранено локально')
  .on(
    acceptedPublish,
    (_, result) => `Опубликована версия ${result.published.versionNumber}`,
  )
  .on(newHallRequested, () => 'Новый зал не сохранён');
$notice.on(recoveryRestored, () => 'Черновик восстановлен');
for (const event of opened) $notice.on(event, () => 'Сохранено локально');

export const $error = createStore<string | null>(null);
for (const effect of [initializeFx, exportHallPackageFx]) {
  $error
    .on(effect.failData, (_, error) => error.message)
    .reset(effect.doneData);
}
for (const event of acceptedNavigationFailures)
  $error.on(event, (_, error) => error.message);
$error.reset(
  acceptedDuplicate,
  acceptedPerformanceHall,
  acceptedDelete,
  acceptedRestore,
  acceptedReset,
  acceptedPublished,
);
$error
  .on(acceptedSaveFailure, (_, error) => error.message)
  .on(acceptedPublishFailure, (_, error) => error.message)
  .on(acceptedImportFailure, (_, error) => error.message)
  .on(acceptedPackageImportFailure, (_, error) => error.message)
  .reset(acceptedSave, acceptedPublish, acceptedImport, acceptedPackageImport);
$error
  .on(acceptedOpenHallFailure, (_, error) => error.message)
  .on(hallMetadataFailed, (_, { error }) =>
    error instanceof Error
      ? error.message
      : 'Не удалось загрузить каталог и опубликованные версии',
  )
  .reset(acceptedOpenHall, hallMetadataLoaded);
$error.reset(newHallRequested);

if (typeof window !== 'undefined') {
  subscribeToDemoChanges((id) => {
    const activeId = $buyerOccurrence.getState()?.id;
    if (activeId && (id === null || id === '*' || id === activeId))
      void refreshDemoOccurrenceFx(activeId).catch(() => undefined);
    if ($mode.getState() === 'events')
      void seedDemoOccurrencesFx().catch(() => undefined);
  });
  seedDemoOccurrencesFx.doneData.watch((events) => {
    const id = readBrowserStorage('session', activeBuyerKey);
    if (!id) return;
    if (
      events.some(
        (event) =>
          event.id === id && findOwnActiveHold(event, getDemoOwnerId()),
      )
    )
      void openDemoEventFx(id).catch(() => undefined);
    else removeBrowserStorage('session', activeBuyerKey);
  });
  holdDemoFx.doneData.watch((occurrence) =>
    writeBrowserStorage('session', activeBuyerKey, occurrence.id),
  );
  for (const effect of [confirmDemoFx, cancelDemoFx])
    effect.doneData.watch(() =>
      removeBrowserStorage('session', activeBuyerKey),
    );
  for (const event of [
    catalogOpened,
    editorOpened,
    previewOpened,
    demoEventsOpened,
  ])
    event.watch(() => removeBrowserStorage('session', activeBuyerKey));
}

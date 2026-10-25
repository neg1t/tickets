import { createEffect, createEvent, createStore, sample } from 'effector';
import { layoutDocumentSchema } from '@hall-platform/domain';
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
  catalog: HallSummary[];
  versions: PublishedHallVersion[];
};

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

async function openStoredHall(id: string): Promise<OpenedHall> {
  const record = await repository.read(id);
  if (!record) throw new Error('Зал не найден в локальном хранилище');
  return {
    record,
    catalog: await repository.list(),
    versions: await repository.listPublished(id),
  };
}

let initialLoad: Promise<OpenedHall> | null = null;
export const initializeFx = createEffect(() => {
  initialLoad ??= (async () => {
    await seedFixtures();
    const catalog = await repository.list();
    const preferred = readBrowserStorage('local', activeHallKey);
    const id = catalog.some((hall) => hall.id === preferred)
      ? preferred
      : catalog.some((hall) => hall.id === sampleDraft.snapshot.id)
        ? sampleDraft.snapshot.id
        : catalog[0]?.id;
    if (!id)
      throw new Error('Нет доступных залов. Проверьте локальное хранилище');
    return openStoredHall(id);
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
    let version: PublishedHallVersion | undefined;
    try {
      version = (await repository.listPublished(fixture.snapshot.id))[0];
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
export const openBuyerFx = createEffect(async (version: PublishedHallVersion) =>
  demoBookingRepository.ensure(
    createDemoOccurrence(
      `demo:${version.versionId}`,
      version.layout,
      version.hallId,
    ),
  ),
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
      versions: await repository.listPublished(record.id),
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
    assertImportFile(file, 'json');
    const text = await file.text();
    assertImportBytes(new TextEncoder().encode(text).byteLength, 'json');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('Некорректный JSON-файл');
    }
    assertDraftImportLimits(value);
    let parsed: HallLayoutDraft;
    try {
      parsed = parseHallLayoutDraft(value);
    } catch {
      throw new Error('JSON не соответствует схеме зала');
    }
    const draft = (await repository.get(parsed.snapshot.id))
      ? duplicateHallDraft(parsed)
      : parsed;
    requireCurrentNavigation(requestId, epoch);
    await repository.save(draft, 0);
    return openStoredHall(draft.snapshot.id);
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
];
for (const event of [
  acceptedOpenHall,
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
  acceptedDuplicate,
  acceptedImport,
  acceptedPackageImport,
  acceptedDelete,
  acceptedRestore,
  acceptedReset,
];
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
for (const event of opened) $catalog.on(event, (_, result) => result.catalog);
$catalog
  .on(acceptedSave, (_, result) => result.catalog)
  .on(acceptedPublish, (_, result) => result.catalog);

export const $ready = createStore(false).on(initializeFx.doneData, () => true);

export const $revision = createStore<number | null>(null)
  .on(newHallRequested, () => null)
  .on(recoveryRestored, (_, recovery) => recovery.baseRevision)
  .on(acceptedSave, (_, result) => result.record.revision)
  .on(acceptedPublish, (_, result) => result.record.revision);
for (const event of opened)
  $revision.on(event, (_, result) => result.record.revision);

export const $versions = createStore<PublishedHallVersion[]>([])
  .on(newHallRequested, () => [])
  .on(acceptedPublish, (_, result) => result.versions);
for (const event of opened) $versions.on(event, (_, result) => result.versions);

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
for (const event of [acceptedOpenHall, acceptedImport, acceptedPackageImport])
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
  .reset(acceptedOpenHall);
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

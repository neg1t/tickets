import { createEffect, createEvent, createStore, sample } from 'effector';
import { layoutDocumentSchema } from '@hall-platform/domain';
import arena from '@hall-platform/fixtures/arena.json';
import banquetHall from '@hall-platform/fixtures/banquet-hall.json';
import operaHall from '@hall-platform/fixtures/opera-hall.json';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import {
  createDraftFromSnapshot,
  createEmptyDraft,
  parseHallLayoutDraft,
  type HallLayoutDraft,
} from '@hall-platform/hall-editor';
import {
  createLocalHallRepository,
  duplicateHallDraft,
  type HallSummary,
  type PublishedHallVersion,
  type StoredHall,
} from '@hall-platform/local-storage';
import type { SeatSelectionItem } from '@hall-platform/seat-view';
import {
  createDemoOccurrence,
  type DemoOccurrence,
  type DemoOrder,
} from './demoBooking.js';
import { demoBookingRepository } from './demoBookingRepository.js';

const repository = createLocalHallRepository();
const activeHallKey = 'hall-platform-active-hall';
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
    if (!(await repository.get(draft.snapshot.id))) {
      await repository.publishDraft(draft, 0);
    }
  }
}

async function openStoredHall(id: string): Promise<OpenedHall> {
  const record = await repository.read(id);
  if (!record) throw new Error('Зал не найден в локальном хранилище');
  localStorage.setItem(activeHallKey, id);
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
    const preferred = localStorage.getItem(activeHallKey);
    const id = catalog.some((hall) => hall.id === preferred)
      ? preferred
      : sampleDraft.snapshot.id;
    return openStoredHall(id ?? sampleDraft.snapshot.id);
  })();
  return initialLoad;
});

export const openHallFx = createEffect(openStoredHall);
export const sampleHallRequested = createEvent();
sample({
  clock: sampleHallRequested,
  fn: () => sampleDraft.snapshot.id,
  target: openHallFx,
});
export const newHallRequested = createEvent();
export const draftChanged = createEvent<HallLayoutDraft>();
export const editorOpened = createEvent();
export const previewOpened = createEvent();
export const demoEventsOpened = createEvent();
export const seatSelectionChanged = createEvent<SeatSelectionItem[]>();

export const seedDemoOccurrencesFx = createEffect(async () => {
  for (const fixture of fixtures) {
    const version = (await repository.listPublished(fixture.snapshot.id))[0];
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
  }) => {
    const record = await repository.save(draft, revision ?? 0);
    localStorage.setItem(activeHallKey, record.id);
    return { record, catalog: await repository.list(), sourceDraft: draft };
  },
);

export const publishDraftFx = createEffect(
  async ({
    draft,
    revision,
  }: {
    draft: HallLayoutDraft;
    revision: number | null;
  }) => {
    const { record, published } = await repository.publishDraft(
      draft,
      revision ?? 0,
    );
    localStorage.setItem(activeHallKey, record.id);
    return {
      record,
      published,
      catalog: await repository.list(),
      versions: await repository.listPublished(record.id),
      sourceDraft: draft,
    };
  },
);

export const duplicateHallFx = createEffect(
  async (draft: HallLayoutDraft): Promise<OpenedHall> => {
    const copy = duplicateHallDraft(draft);
    await repository.save(copy, 0);
    return openStoredHall(copy.snapshot.id);
  },
);

export const importDraftFx = createEffect(
  async (file: File): Promise<OpenedHall> => {
    const parsed = parseHallLayoutDraft(JSON.parse(await file.text()));
    const draft = (await repository.get(parsed.snapshot.id))
      ? duplicateHallDraft(parsed)
      : parsed;
    await repository.save(draft, 0);
    return openStoredHall(draft.snapshot.id);
  },
);

export const deleteHallFx = createEffect(
  async (id: string): Promise<OpenedHall> => {
    await repository.delete(id);
    const catalog = await repository.list();
    if (catalog.length === 0) await seedFixtures();
    const remaining = await repository.list();
    return openStoredHall(remaining[0]?.id ?? sampleDraft.snapshot.id);
  },
);

export const restoreFixturesFx = createEffect(async (): Promise<OpenedHall> => {
  for (const draft of fixtures) {
    const existing = await repository.read(draft.snapshot.id);
    await repository.publishDraft(draft, existing?.revision ?? 0);
  }
  return openStoredHall(sampleDraft.snapshot.id);
});

export const resetDemoDataFx = createEffect(async (): Promise<OpenedHall> => {
  await repository.clear();
  await demoBookingRepository.clear();
  await seedFixtures();
  return openStoredHall(sampleDraft.snapshot.id);
});

sample({
  clock: [resetDemoDataFx.doneData, restoreFixturesFx.doneData],
  fn: () => undefined,
  target: seedDemoOccurrencesFx,
});

export const openPublishedFx = createEffect(async (versionId: string) => {
  const published = await repository.getPublished(versionId);
  if (!published) throw new Error('Опубликованная версия не найдена');
  return published;
});

const opened = [
  initializeFx.doneData,
  openHallFx.doneData,
  duplicateHallFx.doneData,
  importDraftFx.doneData,
  deleteHallFx.doneData,
  restoreFixturesFx.doneData,
  resetDemoDataFx.doneData,
];

export const $draft = createStore<HallLayoutDraft>(sampleDraft)
  .on(draftChanged, (_, draft) => draft)
  .on(newHallRequested, () => createEmptyDraft('Новый зал'));
for (const event of opened)
  $draft.on(event, (_, result) => result.record.draft);

export const $catalog = createStore<HallSummary[]>([]);
for (const event of opened) $catalog.on(event, (_, result) => result.catalog);
$catalog
  .on(saveDraftFx.doneData, (_, result) => result.catalog)
  .on(publishDraftFx.doneData, (_, result) => result.catalog);

export const $ready = createStore(false).on(initializeFx.doneData, () => true);

export const $revision = createStore<number | null>(null)
  .on(newHallRequested, () => null)
  .on(saveDraftFx.doneData, (_, result) => result.record.revision)
  .on(publishDraftFx.doneData, (_, result) => result.record.revision);
for (const event of opened)
  $revision.on(event, (_, result) => result.record.revision);

export const $versions = createStore<PublishedHallVersion[]>([])
  .on(newHallRequested, () => [])
  .on(publishDraftFx.doneData, (_, result) => result.versions);
for (const event of opened) $versions.on(event, (_, result) => result.versions);

export const $mode = createStore<
  'preview' | 'editor' | 'published' | 'buyer' | 'events'
>('preview')
  .on(editorOpened, () => 'editor')
  .on(previewOpened, () => 'preview')
  .on(newHallRequested, () => 'editor')
  .on(demoEventsOpened, () => 'events')
  .on(openBuyerFx.doneData, () => 'buyer')
  .on(openDemoEventFx.doneData, () => 'buyer')
  .on(openPublishedFx.doneData, () => 'published');
for (const event of opened.slice(1)) $mode.on(event, () => 'editor');

export const $publishedDraft = createStore<HallLayoutDraft | null>(null)
  .on(openPublishedFx.doneData, (_, published) => published.layout)
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
  );

export const $buyerOccurrence = createStore<DemoOccurrence | null>(null)
  .on(openBuyerFx.doneData, (_, occurrence) => occurrence)
  .on(openDemoEventFx.doneData, (_, occurrence) => occurrence)
  .on(holdDemoFx.doneData, (_, occurrence) => occurrence)
  .on(confirmDemoFx.doneData, (_, occurrence) => occurrence)
  .on(cancelDemoFx.doneData, (_, occurrence) => occurrence)
  .reset(newHallRequested);
for (const event of opened) $buyerOccurrence.reset(event);

export const $activeHoldId = createStore<string | null>(null)
  .on(
    holdDemoFx.doneData,
    (_, occurrence) => occurrence.holds.at(-1)?.id ?? null,
  )
  .reset(
    openBuyerFx.doneData,
    openDemoEventFx.doneData,
    confirmDemoFx.doneData,
    cancelDemoFx.doneData,
  );

export const $receipt = createStore<DemoOrder | null>(null)
  .on(
    confirmDemoFx.doneData,
    (_, occurrence) => occurrence.orders.at(-1) ?? null,
  )
  .reset(openBuyerFx.doneData, openDemoEventFx.doneData);

export const $seatSelection = createStore<SeatSelectionItem[]>([])
  .on(seatSelectionChanged, (_, selection) => selection)
  .reset(
    openBuyerFx.doneData,
    openDemoEventFx.doneData,
    confirmDemoFx.doneData,
    newHallRequested,
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
  clock: saveDraftFx.doneData,
  fn: (current, result) => current !== result.sourceDraft,
  target: draftPersisted,
});
sample({
  source: $draft,
  clock: publishDraftFx.doneData,
  fn: (current, result) => current !== result.sourceDraft,
  target: draftPersisted,
});

export const $dirty = createStore(false)
  .on(draftChanged, () => true)
  .on(newHallRequested, () => true)
  .on(draftPersisted, (_, remainsDirty) => remainsDirty);
for (const event of opened) $dirty.reset(event);

export const $changeCount = createStore(0)
  .on(draftChanged, (count) => count + 1)
  .reset(newHallRequested);
for (const event of opened) $changeCount.reset(event);

export const $notice = createStore('')
  .on(saveDraftFx.doneData, () => 'Сохранено локально')
  .on(
    publishDraftFx.doneData,
    (_, result) => `Опубликована версия ${result.published.versionNumber}`,
  )
  .on(newHallRequested, () => 'Новый зал не сохранён');
for (const event of opened) $notice.on(event, () => 'Сохранено локально');

export const $error = createStore<string | null>(null);
for (const effect of [
  initializeFx,
  openHallFx,
  saveDraftFx,
  publishDraftFx,
  duplicateHallFx,
  importDraftFx,
  deleteHallFx,
  restoreFixturesFx,
  resetDemoDataFx,
  openPublishedFx,
]) {
  $error
    .on(effect.failData, (_, error) => error.message)
    .reset(effect.doneData);
}
$error.reset(newHallRequested);

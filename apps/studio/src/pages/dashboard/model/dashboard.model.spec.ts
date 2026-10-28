import { describe, expect, it, vi } from 'vitest';
import type {
  HallSummary,
  PublishedVersionMetadata,
  StoredHall,
} from '@hall-platform/local-storage';
import {
  $draft,
  $mode,
  $revision,
  importDraftFx,
  duplicateHallFx,
  openHallFx,
  openPublishedFx,
  publishDraftFx,
  requestImportDraft,
  requestDuplicateHall,
  requestOpenHall,
  requestOpenPublished,
  requestPublishDraft,
  requestSaveDraft,
  saveDraftFx,
} from './dashboard.model.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let testOpenSequence = 0;

describe('dashboard async identity', () => {
  it('opens the selected hall before catalog and publication reads finish', async () => {
    const draft = $draft.getState();
    const record: StoredHall = {
      id: draft.snapshot.id,
      draft,
      revision: 1,
      updatedAt: new Date().toISOString(),
      publishedVersionNumber: 0,
    };
    const catalog = deferred<HallSummary[]>();
    const versions = deferred<PublishedVersionMetadata[]>();
    const repository = {
      get: vi.fn(async () => null),
      read: vi.fn(async () => record),
      list: vi.fn(() => catalog.promise),
      listPublishedMetadata: vi.fn(() => versions.promise),
    };
    vi.resetModules();
    vi.doMock('@hall-platform/local-storage', async (importOriginal) => ({
      ...(await importOriginal<
        typeof import('@hall-platform/local-storage')
      >()),
      createLocalHallRepository: () => repository as never,
    }));
    try {
      const model = await import('./dashboard.model.js');
      const opened = await model.requestOpenHall(record.id);

      expect(opened.record.id).toBe(record.id);
      expect(repository.read).toHaveBeenCalledOnce();
      expect(repository.list).toHaveBeenCalledOnce();
      expect(repository.listPublishedMetadata).toHaveBeenCalledOnce();
      catalog.resolve([]);
      versions.resolve([]);
    } finally {
      vi.doUnmock('@hall-platform/local-storage');
      vi.resetModules();
    }
  });

  it('R01: a late A response cannot replace a newer B request', async () => {
    const original = openHallFx.use.getCurrent();
    const first = deferred<Awaited<ReturnType<typeof openHallFx>>>();
    const second = deferred<Awaited<ReturnType<typeof openHallFx>>>();
    const makeResult = (name: string) =>
      ({
        record: {
          id: $draft.getState().snapshot.id,
          draft: { ...$draft.getState(), hallName: name },
          revision: 1,
          updatedAt: new Date().toISOString(),
          publishedVersionNumber: 0,
        },
        catalog: [],
        versions: [],
        openSequence: ++testOpenSequence,
      }) satisfies Awaited<ReturnType<typeof openHallFx>>;
    try {
      openHallFx.use(({ id }) => (id === 'A' ? first.promise : second.promise));
      const pendingA = requestOpenHall('A');
      const pendingB = requestOpenHall('B');
      const resultA = makeResult('A');
      const resultB = makeResult('B');
      second.resolve(resultB);
      await pendingB;
      first.resolve(resultA);
      await pendingA;
      expect($draft.getState().hallName).toBe('B');
    } finally {
      openHallFx.use(original);
    }
  });
  it('R04: initialization retries after a temporary repository error', async () => {
    const initialDraft = $draft.getState();
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValue(initialDraft);
    vi.resetModules();
    vi.doMock('@hall-platform/local-storage', async (importOriginal) => ({
      ...(await importOriginal<
        typeof import('@hall-platform/local-storage')
      >()),
      createLocalHallRepository: () => ({
        get,
        list: async () => [{ id: initialDraft.snapshot.id }],
        read: async () => ({
          id: initialDraft.snapshot.id,
          draft: initialDraft,
          revision: 1,
          updatedAt: new Date().toISOString(),
          publishedVersionNumber: 0,
        }),
        listPublished: async () => [],
        listPublishedMetadata: async () => [],
      }),
      duplicateHallDraft: () => undefined,
    }));
    try {
      const { initializeFx } = await import('./dashboard.model.js');
      await expect(initializeFx()).rejects.toThrow('temporary storage failure');
      await expect(initializeFx()).resolves.toBeDefined();
    } finally {
      vi.doUnmock('@hall-platform/local-storage');
      vi.resetModules();
    }
  });
  it('R01: save, publish and import completions from an earlier document leave the active hall intact', async () => {
    const oldOpen = openHallFx.use.getCurrent();
    const oldSave = saveDraftFx.use.getCurrent();
    const oldPublish = publishDraftFx.use.getCurrent();
    const oldImport = importDraftFx.use.getCurrent();
    const saved = deferred<Awaited<ReturnType<typeof saveDraftFx>>>();
    const published = deferred<Awaited<ReturnType<typeof publishDraftFx>>>();
    const imported = deferred<Awaited<ReturnType<typeof importDraftFx>>>();
    const draft = $draft.getState();
    const hall = (name: string) => ({
      record: {
        id: draft.snapshot.id,
        draft: { ...draft, hallName: name },
        revision: 7,
        updatedAt: new Date().toISOString(),
        publishedVersionNumber: 0,
      },
      catalog: [],
      versions: [],
      openSequence: ++testOpenSequence,
    });
    try {
      saveDraftFx.use(() => saved.promise);
      publishDraftFx.use(() => published.promise);
      importDraftFx.use(() => imported.promise);
      openHallFx.use(async () => hall('New hall'));
      const pendingSave = requestSaveDraft(draft, 1);
      const pendingPublish = requestPublishDraft(draft, 1);
      const pendingImport = requestImportDraft(new File(['{}'], 'hall.json'));
      await requestOpenHall('new-hall');
      saved.resolve({ ...hall('Old save'), sourceDraft: draft });
      published.resolve({
        ...hall('Old publish'),
        sourceDraft: draft,
        published: {
          versionId: 'v1',
          hallId: draft.snapshot.id,
          versionNumber: 1,
          publishedAt: new Date().toISOString(),
          layout: draft,
        },
      });
      imported.resolve(hall('Old import'));
      await Promise.all([pendingSave, pendingPublish, pendingImport]);
      expect($draft.getState().hallName).toBe('New hall');
      expect($revision.getState()).toBe(7);
    } finally {
      openHallFx.use(oldOpen);
      saveDraftFx.use(oldSave);
      publishDraftFx.use(oldPublish);
      importDraftFx.use(oldImport);
    }
  });
  it('R01: a failed import does not discard an active save result', async () => {
    const oldSave = saveDraftFx.use.getCurrent();
    const oldImport = importDraftFx.use.getCurrent();
    const saved = deferred<Awaited<ReturnType<typeof saveDraftFx>>>();
    const draft = $draft.getState();
    const nextRevision = $revision.getState()! + 1;
    try {
      saveDraftFx.use(() => saved.promise);
      importDraftFx.use(async () => {
        throw new Error('bad import');
      });
      const pendingSave = requestSaveDraft(draft, $revision.getState());
      await expect(
        requestImportDraft(new File(['bad'], 'bad.json')),
      ).rejects.toThrow('bad import');
      saved.resolve({
        sourceDraft: draft,
        record: {
          id: draft.snapshot.id,
          draft,
          revision: nextRevision,
          updatedAt: new Date().toISOString(),
          publishedVersionNumber: 0,
        },
        catalog: [],
      });
      await pendingSave;
      expect($revision.getState()).toBe(nextRevision);
    } finally {
      saveDraftFx.use(oldSave);
      importDraftFx.use(oldImport);
    }
  });
  it('R01: late duplicate and published responses cannot replace a newer hall', async () => {
    const oldOpen = openHallFx.use.getCurrent();
    const oldDuplicate = duplicateHallFx.use.getCurrent();
    const oldPublished = openPublishedFx.use.getCurrent();
    const duplicated = deferred<Awaited<ReturnType<typeof duplicateHallFx>>>();
    const published = deferred<Awaited<ReturnType<typeof openPublishedFx>>>();
    const draft = $draft.getState();
    const hall = (name: string) => ({
      record: {
        id: draft.snapshot.id,
        draft: { ...draft, hallName: name },
        revision: 5,
        updatedAt: new Date().toISOString(),
        publishedVersionNumber: 1,
      },
      catalog: [],
      versions: [],
      openSequence: ++testOpenSequence,
    });
    try {
      duplicateHallFx.use(() => duplicated.promise);
      openPublishedFx.use(() => published.promise);
      openHallFx.use(async () => hall('Current B'));
      const pendingDuplicate = requestDuplicateHall(draft);
      const pendingPublished = requestOpenPublished('v1');
      await requestOpenHall('B');
      duplicated.resolve(hall('Stale copy'));
      published.resolve({
        versionId: 'v1',
        hallId: draft.snapshot.id,
        versionNumber: 1,
        publishedAt: new Date().toISOString(),
        layout: draft,
      });
      await Promise.all([pendingDuplicate, pendingPublished]);
      expect($draft.getState().hallName).toBe('Current B');
      expect($mode.getState()).toBe('editor');
    } finally {
      openHallFx.use(oldOpen);
      duplicateHallFx.use(oldDuplicate);
      openPublishedFx.use(oldPublished);
    }
  });
});

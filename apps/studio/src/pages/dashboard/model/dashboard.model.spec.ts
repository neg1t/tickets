import { describe, expect, it, vi } from 'vitest';
import { $draft, openHallFx } from './dashboard.model.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('dashboard async identity', () => {
  it.fails(
    'R01: a late A response cannot replace a newer B request',
    async () => {
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
        }) as Awaited<ReturnType<typeof openHallFx>>;
      try {
        openHallFx.use((id) => (id === 'A' ? first.promise : second.promise));
        const pendingA = openHallFx('A');
        const pendingB = openHallFx('B');
        second.resolve(makeResult('B'));
        await pendingB;
        first.resolve(makeResult('A'));
        await pendingA;
        expect($draft.getState().hallName).toBe('B');
      } finally {
        openHallFx.use(original);
      }
    },
  );
  it.fails(
    'R04: initialization retries after a temporary repository error',
    async () => {
      const get = vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary storage failure'))
        .mockResolvedValue(null);
      vi.resetModules();
      vi.doMock('@hall-platform/local-storage', () => ({
        createLocalHallRepository: () => ({ get }),
        duplicateHallDraft: () => undefined,
      }));
      try {
        const { initializeFx } = await import('./dashboard.model.js');
        await expect(initializeFx()).rejects.toThrow(
          'temporary storage failure',
        );
        await expect(initializeFx()).resolves.toBeDefined();
      } finally {
        vi.doUnmock('@hall-platform/local-storage');
        vi.resetModules();
      }
    },
  );
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '../editorDraft.js';
import {
  createLayoutValidationController,
  validateLatestDraft,
} from './validationController.js';

describe('layout validation controller', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces checks and publishes only the latest draft result', async () => {
    vi.useFakeTimers();
    const completed: string[] = [];
    const controller = createLayoutValidationController(
      async (draft) => {
        completed.push(draft.hallName);
        return [];
      },
      40,
    );
    const first = createEmptyDraft('first');
    const latest = createEmptyDraft('latest');
    const onResult = vi.fn();

    controller.schedule(first, onResult);
    controller.schedule(latest, onResult);
    await vi.advanceTimersByTimeAsync(39);
    expect(completed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(completed).toEqual(['latest']);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({
      draft: latest,
      current: true,
      issues: [],
    });
    controller.dispose();
  });

  it('marks an in-flight publication check stale after a newer revision is scheduled', async () => {
    let resolveOld: ((issues: []) => void) | undefined;
    const controller = createLayoutValidationController(
      () => new Promise((resolve) => { resolveOld = resolve; }),
      100,
    );
    const oldDraft = createEmptyDraft('old');
    const newDraft = createEmptyDraft('new');
    const oldResult = controller.validateNow(oldDraft);
    controller.schedule(newDraft, vi.fn());
    resolveOld?.([]);

    await expect(oldResult).resolves.toMatchObject({
      draft: oldDraft,
      current: false,
      issues: [],
    });
    controller.dispose();
  });

  it('revalidates the latest draft before publication when the layout changes mid-check', async () => {
    let resolveOld: ((issues: []) => void) | undefined;
    const oldDraft = createEmptyDraft('old');
    const latestDraft = createEmptyDraft('latest');
    let currentDraft = oldDraft;
    const execute = vi.fn((draft: ReturnType<typeof createEmptyDraft>) => {
      if (draft === oldDraft)
        return new Promise<[]>((resolve) => { resolveOld = resolve; });
      return Promise.resolve([]);
    });
    const controller = createLayoutValidationController(execute, 100);

    const validation = validateLatestDraft(controller, () => currentDraft);
    currentDraft = latestDraft;
    controller.schedule(latestDraft, vi.fn());
    resolveOld?.([]);
    const result = await validation;

    expect(result).toMatchObject({ draft: latestDraft, current: true, issues: [] });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map(([draft]) => draft.hallName)).toEqual([
      'old',
      'latest',
    ]);
    controller.dispose();
  });

  it('does not deliver results after disposal', async () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    const controller = createLayoutValidationController(async () => [], 0);
    controller.schedule(createEmptyDraft('disposed'), onResult);
    controller.dispose();
    await vi.runAllTimersAsync();

    expect(onResult).not.toHaveBeenCalled();
  });

  it('can be reactivated after a development Strict Mode cleanup', async () => {
    vi.useFakeTimers();
    const onResult = vi.fn();
    const controller = createLayoutValidationController(async () => [], 0);
    controller.dispose();
    controller.activate();
    controller.schedule(createEmptyDraft('reactivated'), onResult);
    await vi.runAllTimersAsync();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0].current).toBe(true);
    controller.dispose();
  });

  it('falls back after a worker error and creates a fresh worker for later checks', async () => {
    vi.useFakeTimers();
    type FakeRequest = {
      revision: number;
      draft: ReturnType<typeof createEmptyDraft>;
    };
    type FakeResponse = { revision: number; issues: [] };
    type FakeEvent = { data?: FakeResponse; message?: string };
    class FakeWorker {
      readonly listeners = new Map<string, (event: FakeEvent) => void>();
      terminated = false;

      addEventListener(
        type: 'message' | 'error',
        listener: (event: FakeEvent) => void,
      ) {
        this.listeners.set(type, listener);
      }

      postMessage(request: FakeRequest) {
        if (workers[0] === this)
          this.listeners.get('error')?.({ message: 'simulated worker failure' });
        else
          this.listeners.get('message')?.({
            data: { revision: request.revision, issues: [] },
          });
      }

      terminate() {
        this.terminated = true;
      }
    }
    const workers: FakeWorker[] = [];
    class StubWorker extends FakeWorker {
      constructor() {
        super();
        workers.push(this);
      }
    }
    vi.stubGlobal('Worker', StubWorker);
    const controller = createLayoutValidationController(undefined, 0);
    const firstResults: unknown[] = [];
    controller.schedule(createEmptyDraft('fallback'), (result) => {
      firstResults.push(result);
    });
    await vi.runAllTimersAsync();

    expect(firstResults).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(true);
    const latest = await controller.validateNow(createEmptyDraft('retry'));
    expect(latest).toMatchObject({ current: true, issues: [] });
    expect(workers).toHaveLength(2);
    expect(workers[1]?.terminated).toBe(false);
    controller.dispose();
    expect(workers[1]?.terminated).toBe(true);
  });
});

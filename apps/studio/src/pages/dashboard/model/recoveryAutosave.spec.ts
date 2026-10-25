import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '@hall-platform/hall-editor';
import {
  HallStorageError,
  type RecoveryDraft,
} from '@hall-platform/local-storage';
import { createRecoveryAutosave } from './recoveryAutosave.js';

const draft = createEmptyDraft('Autosave');
const saved: RecoveryDraft = {
  hallId: draft.snapshot.id,
  draft,
  baseRevision: 3,
  updatedAt: '2026-10-25T00:00:00.000Z',
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recovery autosave', () => {
  it('saves the latest change after 700 ms of inactivity', async () => {
    const save = vi.fn(async () => saved);
    const controller = createRecoveryAutosave({ save });
    const states: string[] = [];
    controller.subscribe((status) => states.push(status.state));

    controller.schedule(draft, 3);
    await vi.advanceTimersByTimeAsync(699);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledExactlyOnceWith(draft, 3);
    expect(states).toEqual(['idle', 'changed', 'saving', 'saved']);
    expect(controller.getStatus()).toEqual({
      state: 'saved',
      updatedAt: saved.updatedAt,
    });
  });

  it('saves within five seconds despite continuous changes', async () => {
    const save = vi.fn(async () => saved);
    const controller = createRecoveryAutosave({ save });
    controller.schedule(draft, 0);
    for (let change = 1; change <= 8; change += 1) {
      await vi.advanceTimersByTimeAsync(600);
      controller.schedule(draft, change);
    }
    await vi.advanceTimersByTimeAsync(199);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(draft, 8);
  });

  it('flushes immediately and cancels scheduled timers', async () => {
    const save = vi.fn(async () => saved);
    const controller = createRecoveryAutosave({ save });
    controller.schedule(draft, 3);

    await controller.flush();
    expect(save).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledOnce();
    expect(controller.getStatus().state).toBe('saved');
  });

  it('cancels pending work and ignores an in-flight result', async () => {
    let complete!: (value: RecoveryDraft) => void;
    const save = vi.fn(
      () =>
        new Promise<RecoveryDraft>((resolve) => {
          complete = resolve;
        }),
    );
    const controller = createRecoveryAutosave({ save });
    controller.schedule(draft, 3);
    await vi.advanceTimersByTimeAsync(700);
    expect(controller.getStatus().state).toBe('saving');
    controller.cancel();
    complete(saved);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledOnce();
    expect(controller.getStatus().state).toBe('idle');
  });

  it('publishes quota errors and lets flush report the failure', async () => {
    const quota = new HallStorageError('quota', 'Quota exceeded');
    const save = vi.fn().mockRejectedValue(quota);
    const controller = createRecoveryAutosave({ save });
    controller.schedule(draft, 3);

    await expect(controller.flush()).rejects.toBe(quota);
    expect(controller.getStatus()).toEqual({ state: 'error', error: quota });
    expect(save).toHaveBeenCalledOnce();
  });

  it('persists edits made while an earlier save is in flight', async () => {
    let completeFirst!: (value: RecoveryDraft) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<RecoveryDraft>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockResolvedValue(saved);
    const controller = createRecoveryAutosave({ save });
    controller.schedule(draft, 1);
    await vi.advanceTimersByTimeAsync(700);
    controller.schedule(draft, 2);
    const flushed = controller.flush();
    completeFirst(saved);
    await flushed;

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, draft, 2);
    expect(controller.getStatus().state).toBe('saved');
  });
});

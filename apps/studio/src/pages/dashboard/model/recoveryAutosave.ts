import type { HallLayoutDraft } from '@hall-platform/hall-editor';
import {
  createRecoveryRepository,
  type RecoveryRepository,
} from '@hall-platform/local-storage';

export type RecoveryAutosaveStatus =
  | { state: 'idle' | 'changed' | 'saving' }
  | { state: 'saved'; updatedAt: string }
  | { state: 'error'; error: Error };

type PendingSave = { draft: HallLayoutDraft; baseRevision: number };
type SaveRepository = Pick<RecoveryRepository, 'save'>;

const debounceMs = 700;
const maxWaitMs = 5_000;

export function createRecoveryAutosave(
  repository: SaveRepository = createRecoveryRepository(),
) {
  let status: RecoveryAutosaveStatus = { state: 'idle' };
  let pending: PendingSave | null = null;
  let inFlight: Promise<void> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const listeners = new Set<(status: RecoveryAutosaveStatus) => void>();

  function publish(next: RecoveryAutosaveStatus) {
    status = next;
    for (const listener of listeners) listener(status);
  }

  function clearTimers() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (maxWaitTimer !== null) clearTimeout(maxWaitTimer);
    debounceTimer = null;
    maxWaitTimer = null;
  }

  function startSave(): Promise<void> {
    if (inFlight) return inFlight.then(startSave, startSave);
    if (!pending) return Promise.resolve();
    clearTimers();
    const item = pending;
    pending = null;
    const startedGeneration = generation;
    publish({ state: 'saving' });
    const task = repository
      .save(item.draft, item.baseRevision)
      .then(
        (record) => {
          if (generation !== startedGeneration) return;
          publish(
            pending
              ? { state: 'changed' }
              : { state: 'saved', updatedAt: record.updatedAt },
          );
        },
        (reason: unknown) => {
          if (generation === startedGeneration) {
            pending ??= item;
            publish({
              state: 'error',
              error:
                reason instanceof Error ? reason : new Error(String(reason)),
            });
          }
          throw reason;
        },
      )
      .finally(() => {
        if (inFlight === task) inFlight = null;
      });
    inFlight = task;
    return task;
  }

  function schedule(draft: HallLayoutDraft, baseRevision: number): void {
    pending = { draft, baseRevision };
    publish({ state: 'changed' });
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void startSave().catch(() => undefined);
    }, debounceMs);
    maxWaitTimer ??= setTimeout(() => {
      maxWaitTimer = null;
      void startSave().catch(() => undefined);
    }, maxWaitMs);
  }

  async function flush(): Promise<void> {
    clearTimers();
    while (pending || inFlight) {
      if (inFlight) await inFlight;
      else await startSave();
    }
  }

  function cancel(): void {
    generation += 1;
    pending = null;
    clearTimers();
    publish({ state: 'idle' });
  }

  function subscribe(
    listener: (status: RecoveryAutosaveStatus) => void,
  ): () => void {
    listeners.add(listener);
    listener(status);
    return () => listeners.delete(listener);
  }

  return { schedule, flush, cancel, subscribe, getStatus: () => status };
}

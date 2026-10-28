import type { HallLayoutDraft } from '../editorDraft.js';
import { validateLayout, type LayoutIssue } from './validateLayout.js';

export type LayoutValidationResult = Readonly<{
  revision: number;
  draft: HallLayoutDraft;
  issues: LayoutIssue[];
  current: boolean;
}>;

export type LayoutValidationExecutor = (
  draft: HallLayoutDraft,
  revision: number,
) => Promise<LayoutIssue[]>;

type WorkerRequest = Readonly<{
  revision: number;
  draft: HallLayoutDraft;
}>;

type WorkerResponse = Readonly<
  | { revision: number; issues: LayoutIssue[] }
  | { revision: number; error: string }
>;

type ValidationWorker = {
  postMessage(message: WorkerRequest): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
};

type WorkerExecutor = LayoutValidationExecutor & { dispose(): void };

function createWorkerExecutor(): WorkerExecutor {
  if (typeof Worker === 'undefined')
    return Object.assign(
      async (draft: HallLayoutDraft) => validateLayout(draft),
      { dispose: () => undefined },
    );

  let worker: ValidationWorker | null = null;
  let nextRequestId = 0;
  const pending = new Map<
    number,
    {
      draft: HallLayoutDraft;
      resolve(issues: LayoutIssue[]): void;
      reject(error: Error): void;
    }
  >();

  const getWorker = () => {
    if (worker) return worker;
    const created = new Worker(
      new URL('./layoutValidation.worker.js', import.meta.url),
      { type: 'module' },
    ) as ValidationWorker;
    created.addEventListener('message', ({ data }) => {
      const request = pending.get(data.revision);
      if (!request) return;
      pending.delete(data.revision);
      if ('error' in data) request.reject(new Error(data.error));
      else request.resolve(data.issues);
    });
    created.addEventListener('error', (event) => {
      if (worker === created) worker = null;
      created.terminate();
      for (const request of pending.values()) {
        try {
          request.resolve(validateLayout(request.draft));
        } catch (error) {
          request.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
      pending.clear();
    });
    worker = created;
    return created;
  };

  const execute: WorkerExecutor = Object.assign(
    (draft: HallLayoutDraft) =>
      new Promise<LayoutIssue[]>((resolve, reject) => {
        const requestId = ++nextRequestId;
        pending.set(requestId, { draft, resolve, reject });
        try {
          getWorker().postMessage({ revision: requestId, draft });
        } catch (error) {
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    {
      dispose() {
        worker?.terminate();
        worker = null;
        for (const request of pending.values())
          request.reject(new Error('Layout validation worker was disposed'));
        pending.clear();
      },
    },
  );
  return execute;
}

export function createLayoutValidationController(
  execute: LayoutValidationExecutor = createWorkerExecutor(),
  debounceMs = 120,
) {
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const executor = execute as LayoutValidationExecutor & {
    dispose?: () => void;
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const validateNow = async (
    draft: HallLayoutDraft,
  ): Promise<LayoutValidationResult> => {
    if (disposed) throw new Error('Layout validation controller is disposed');
    clearTimer();
    const requestRevision = ++revision;
    const issues = await execute(draft, requestRevision);
    return {
      revision: requestRevision,
      draft,
      issues,
      current: !disposed && requestRevision === revision,
    };
  };

  return {
    activate() {
      disposed = false;
    },
    schedule(
      draft: HallLayoutDraft,
      onResult: (result: LayoutValidationResult) => void,
      onError?: (error: Error) => void,
    ) {
      const requestRevision = ++revision;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void execute(draft, requestRevision).then(
          (issues) => {
            if (disposed || requestRevision !== revision) return;
            onResult({
              revision: requestRevision,
              draft,
              issues,
              current: true,
            });
          },
          (error: unknown) => {
            if (disposed || requestRevision !== revision) return;
            onError?.(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }, debounceMs);
      return requestRevision;
    },
    validateNow,
    dispose() {
      disposed = true;
      revision += 1;
      clearTimer();
      executor.dispose?.();
    },
  };
}

export async function validateLatestDraft(
  controller: Pick<
    ReturnType<typeof createLayoutValidationController>,
    'validateNow'
  >,
  getLatestDraft: () => HallLayoutDraft,
): Promise<LayoutValidationResult> {
  let draft = getLatestDraft();
  let result = await controller.validateNow(draft);
  while (!result.current || getLatestDraft() !== draft) {
    draft = getLatestDraft();
    result = await controller.validateNow(draft);
  }
  return result;
}

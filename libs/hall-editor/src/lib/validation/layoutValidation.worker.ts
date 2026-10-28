import type { HallLayoutDraft } from '../editorDraft.js';
import { validateLayout, type LayoutIssue } from './validateLayout.js';

type Request = Readonly<{
  revision: number;
  draft: HallLayoutDraft;
}>;

type Response = Readonly<
  | { revision: number; issues: LayoutIssue[] }
  | { revision: number; error: string }
>;

type WorkerScope = {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<Request>) => void,
  ): void;
  postMessage(message: Response): void;
};

const workerScope = globalThis as unknown as WorkerScope;

workerScope.addEventListener('message', ({ data }) => {
  try {
    workerScope.postMessage({
      revision: data.revision,
      issues: validateLayout(data.draft),
    });
  } catch (error) {
    workerScope.postMessage({
      revision: data.revision,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

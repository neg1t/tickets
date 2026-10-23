import { createEvent, createStore } from 'effector';
import type { HallTarget } from '@hall-platform/renderer-konva';
import {
  applyEditorCommand,
  createEditorState,
  redoEditor,
  undoEditor,
  type EditorCommand,
  type EditorState,
} from './editorCommands.js';
import type { HallLayoutDraft } from './editorDraft.js';
import type { EditorTool } from './editorOperations.js';

export function createEditorModel(initial: HallLayoutDraft) {
  const stateChanged = createEvent<EditorState>();
  const selectionChanged = createEvent<readonly HallTarget[]>();
  const toolChanged = createEvent<EditorTool>();
  const zoneChanged = createEvent<string>();
  const backgroundChanged = createEvent<string>();
  const $state = createStore(createEditorState(initial)).on(
    stateChanged,
    (_, state) => state,
  );
  const $selection = createStore<readonly HallTarget[]>([]).on(
    selectionChanged,
    (_, selection) => selection,
  );
  const $tool = createStore<EditorTool>('select').on(
    toolChanged,
    (_, tool) => tool,
  );
  const $zoneId = createStore('').on(zoneChanged, (_, zoneId) => zoneId);
  const $backgroundId = createStore('').on(backgroundChanged, (_, id) => id);

  return {
    $state,
    $selection,
    $tool,
    $zoneId,
    $backgroundId,
    selectionChanged,
    toolChanged,
    zoneChanged,
    backgroundChanged,
    replace(value: HallLayoutDraft) {
      if ($state.getState().draft === value) return;
      stateChanged(createEditorState(value));
      selectionChanged([]);
      zoneChanged('');
      backgroundChanged('');
    },
    commit(command: EditorCommand) {
      const previous = $state.getState();
      const next = applyEditorCommand(previous, command);
      if (next !== previous) stateChanged(next);
      return next;
    },
    undo() {
      const previous = $state.getState();
      const next = undoEditor(previous);
      if (next !== previous) stateChanged(next);
      return next;
    },
    redo() {
      const previous = $state.getState();
      const next = redoEditor(previous);
      if (next !== previous) stateChanged(next);
      return next;
    },
  };
}

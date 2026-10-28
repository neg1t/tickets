import { createEvent, createStore } from 'effector';
import type { HallTarget } from '@hall-platform/renderer-core';
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

function equivalentValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equivalentValue(item, right[index]))
    );
  }
  if (Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        equivalentValue(leftRecord[key], rightRecord[key]),
    )
  );
}

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
      if (equivalentValue($state.getState().draft, value)) return;
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

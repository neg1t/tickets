import { describe, expect, it } from 'vitest';
import {
  applyEditorCommand,
  createEditorState,
  undoEditor,
} from '../editorCommands.js';
import { createEmptyDraft } from '../editorDraft.js';
import { createObjectAt } from '../editorOperations.js';
import {
  createFloor,
  deleteFloor,
  renameFloor,
  createDecoration,
} from './structureOperations.js';

describe('hall structure commands', () => {
  it('adds, renames and removes a floor with one undoable cascade', () => {
    let state = createEditorState(createEmptyDraft('Hall'));
    const command = createFloor(state.draft, 'Балкон');
    state = applyEditorCommand(state, command);
    const floor = state.draft.snapshot.floors[1];
    expect(floor?.name).toBe('Балкон');
    if (!floor) throw new Error('Missing floor');
    state = applyEditorCommand(state, renameFloor(floor, 'Ярус'));
    expect(state.draft.snapshot.floors[1]?.name).toBe('Ярус');
    state = applyEditorCommand(
      state,
      createDecoration(state.draft, 'stage', { x: 0, y: 0 }, floor.id),
    );
    state = applyEditorCommand(
      state,
      createObjectAt(
        state.draft,
        'row-line',
        { x: 0, y: 6 },
        undefined,
        floor.id,
      ).command,
    );
    expect(state.draft.snapshot.seats).toHaveLength(8);
    const beforeDelete = state;
    state = applyEditorCommand(state, deleteFloor(state.draft, floor.id));
    expect(state.draft.snapshot.floors).toHaveLength(1);
    expect(state.draft.snapshot.rows).toHaveLength(0);
    expect(state.draft.snapshot.seats).toHaveLength(0);
    expect(state.draft.snapshot.decorations).toHaveLength(0);
    expect(undoEditor(state).draft).toEqual(beforeDelete.draft);
  });

  it('keeps stage, label and obstacle separate from saleable seats', () => {
    let state = createEditorState(createEmptyDraft('Hall'));
    for (const kind of ['stage', 'label', 'obstacle'] as const) {
      state = applyEditorCommand(
        state,
        createDecoration(state.draft, kind, { x: 0, y: 0 }),
      );
    }
    expect(state.draft.snapshot.decorations).toHaveLength(3);
    expect(state.draft.snapshot.seats).toHaveLength(0);
  });
});

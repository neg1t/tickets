import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from './editorDraft.js';
import { createEditorModel } from './editorModel.js';
import { createObjectAt } from './editorOperations.js';

describe('editor model', () => {
  it('R02: an equivalent controlled value preserves undo history', () => {
    const draft = createEmptyDraft('Shared source');
    const model = createEditorModel(draft);
    const zone = createObjectAt(draft, 'zone', { x: 5, y: 5 });
    model.commit(zone.command);
    model.replace(structuredClone(model.$state.getState().draft));
    expect(model.undo().draft.snapshot.zones).toHaveLength(0);
  });

  it('replaces stale undo history when an external draft changes the layout', () => {
    const draft = createEmptyDraft('Shared source');
    const model = createEditorModel(draft);
    const zone = createObjectAt(draft, 'zone', { x: 5, y: 5 });
    model.commit(zone.command);
    model.selectionChanged([zone.target]);

    model.replace({
      ...model.$state.getState().draft,
      hallName: 'Externally changed',
    });

    expect(model.$state.getState().past).toHaveLength(0);
    expect(model.$selection.getState()).toEqual([]);
    expect(model.undo().draft.hallName).toBe('Externally changed');
  });

  it('isolates two editors on the same page', () => {
    const draft = createEmptyDraft('Shared source');
    const first = createEditorModel(draft);
    const second = createEditorModel(draft);
    const zone = createObjectAt(draft, 'zone', { x: 5, y: 5 });

    first.commit(zone.command);
    first.selectionChanged([zone.target]);

    expect(first.$state.getState().draft.snapshot.zones).toHaveLength(1);
    expect(second.$state.getState().draft.snapshot.zones).toHaveLength(0);
    expect(second.$selection.getState()).toEqual([]);
  });
});

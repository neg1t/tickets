import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from './editorDraft.js';
import { createEditorModel } from './editorModel.js';
import { createObjectAt } from './editorOperations.js';

describe('editor model', () => {
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

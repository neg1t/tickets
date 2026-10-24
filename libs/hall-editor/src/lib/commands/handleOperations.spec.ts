import { describe, expect, it } from 'vitest';
import { worldPointSchema } from '@hall-platform/domain';
import {
  applyEditorCommand,
  createEditorState,
  undoEditor,
} from '../editorCommands.js';
import { createEmptyDraft } from '../editorDraft.js';
import { createObjectAt } from '../editorOperations.js';
import { editHandle } from './handleOperations.js';

describe('direct manipulation handles', () => {
  it('moves a row endpoint and regenerates seats in one undoable command', () => {
    let state = createEditorState(createEmptyDraft('Handles'));
    const created = createObjectAt(state.draft, 'row-line', { x: 0, y: 0 });
    state = applyEditorCommand(state, created.command);
    const before = state.draft.snapshot.seats.map((seat) => seat.position);
    const pastLength = state.past.length;
    state = applyEditorCommand(
      state,
      editHandle(state.draft, created.target, 'end', { x: 8, y: 0 }),
    );
    const row = state.draft.snapshot.rows[0];
    expect(row?.curve.kind).toBe('line');
    if (row?.curve.kind === 'line')
      expect(row.curve.end).toEqual({ x: 8, y: 0 });
    expect(state.draft.snapshot.seats.map((seat) => seat.position)).not.toEqual(
      before,
    );
    expect(state.past).toHaveLength(pastLength + 1);
    expect(
      undoEditor(state).draft.snapshot.seats.map((seat) => seat.position),
    ).toEqual(before);
  });

  it('resizes zone bounds from southeast corner', () => {
    let state = createEditorState(createEmptyDraft('Handles'));
    const created = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, created.command);
    state = applyEditorCommand(
      state,
      editHandle(state.draft, created.target, 'bounds:se', { x: 8, y: 9 }),
    );
    expect(state.draft.zoneBounds[created.target.id]).toEqual({
      minX: -5,
      minY: -4,
      maxX: 8,
      maxY: 9,
    });
  });

  it('resizes a polygon zone by moving its northwest handle', () => {
    let state = createEditorState(createEmptyDraft('Polygon'));
    const created = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, created.command);
    const zone = state.draft.snapshot.zones[0];
    if (!zone) throw new Error('Missing zone');
    state = applyEditorCommand(state, {
      kind: 'update',
      patches: [
        {
          collection: 'zones',
          id: zone.id,
          before: zone,
          after: {
            ...zone,
            polygon: [
              { x: -5, y: -4 },
              { x: 5, y: -4 },
              { x: 5, y: 4 },
              { x: -5, y: 4 },
            ].map((point) => worldPointSchema.parse(point)),
          },
        },
        {
          collection: 'zoneBounds',
          id: zone.id,
          before: state.draft.zoneBounds[zone.id] ?? null,
          after: null,
        },
      ],
    });
    state = applyEditorCommand(
      state,
      editHandle(state.draft, created.target, 'bounds:nw', { x: -8, y: -6 }),
    );
    expect(state.draft.snapshot.zones[0]?.polygon?.[0]).toEqual({
      x: -8,
      y: -6,
    });
    expect(state.draft.snapshot.zones[0]?.polygon?.[2]).toEqual({ x: 5, y: 4 });
  });

  it('resizes and rotates a table while keeping its generated seats attached', () => {
    let state = createEditorState(createEmptyDraft('Handles'));
    const created = createObjectAt(state.draft, 'table-circle', { x: 0, y: 0 });
    state = applyEditorCommand(state, created.command);
    state = applyEditorCommand(
      state,
      editHandle(state.draft, created.target, 'size', { x: 4, y: 0 }),
    );
    expect(state.draft.snapshot.tables[0]?.shape).toMatchObject({ radius: 4 });
    state = applyEditorCommand(
      state,
      editHandle(state.draft, created.target, 'rotate', { x: 0, y: 5 }),
    );
    expect(state.draft.snapshot.tables[0]?.rotationRadians).toBeCloseTo(
      Math.PI / 2,
    );
    expect(
      state.draft.snapshot.seats.every(
        (seat) => seat.placement.kind === 'table',
      ),
    ).toBe(true);
  });

  it('rotates a standalone seat with one undo', () => {
    let state = createEditorState(createEmptyDraft('Handles'));
    const created = createObjectAt(state.draft, 'seat', { x: 2, y: 3 });
    state = applyEditorCommand(state, created.command);
    state = applyEditorCommand(
      state,
      editHandle(state.draft, created.target, 'rotate', { x: 2, y: 5 }),
    );
    expect(state.draft.snapshot.seats[0]?.rotationRadians).toBeCloseTo(
      Math.PI / 2,
    );
    expect(
      undoEditor(state).draft.snapshot.seats[0]?.rotationRadians,
    ).toBeUndefined();
  });
});

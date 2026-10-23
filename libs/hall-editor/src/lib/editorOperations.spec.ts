import { describe, expect, it } from 'vitest';
import { floorIdSchema } from '@hall-platform/domain';
import { createEmptyDraft } from './editorDraft.js';
import {
  applyEditorCommand,
  createEditorState,
  undoEditor,
} from './editorCommands.js';
import {
  createObjectAt,
  deleteTarget,
  deleteTargets,
  moveTarget,
  moveTargets,
} from './editorOperations.js';

describe('editor tools', () => {
  it.fails('creates a straight row with seats in one command (A03)', () => {
    const state = createEditorState(createEmptyDraft('My hall'));
    const row = createObjectAt(state.draft, 'row-line', { x: 10, y: 10 });
    const created = applyEditorCommand(state, row.command);
    expect(created.draft.snapshot.rows).toHaveLength(1);
    expect(created.draft.snapshot.seats.length).toBeGreaterThan(0);
  });

  it.fails('creates a round table with seats in one command (A03)', () => {
    const state = createEditorState(createEmptyDraft('My hall'));
    const table = createObjectAt(state.draft, 'table-circle', { x: 10, y: 10 });
    const created = applyEditorCommand(state, table.command);
    expect(created.draft.snapshot.tables).toHaveLength(1);
    expect(created.draft.snapshot.seats.length).toBeGreaterThan(0);
  });
  it('creates on the selected floor and rejects a zone from another floor', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const secondFloor = {
      id: floorIdSchema.parse('floor-upper'),
      layoutVersionId: state.draft.snapshot.layoutVersionId,
      name: 'Балкон',
    };
    state = createEditorState({
      ...state.draft,
      snapshot: {
        ...state.draft.snapshot,
        floors: [...state.draft.snapshot.floors, secondFloor],
      },
    });
    const zone = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, zone.command);

    const seat = createObjectAt(
      state.draft,
      'seat',
      { x: 3, y: 4 },
      undefined,
      secondFloor.id,
    );
    state = applyEditorCommand(state, seat.command);
    expect(state.draft.snapshot.seats[0]?.floorId).toBe(secondFloor.id);
    expect(() =>
      createObjectAt(
        state.draft,
        'row-line',
        { x: 0, y: 0 },
        zone.target.id,
        secondFloor.id,
      ),
    ).toThrow('Selected zone is not on the active floor');
  });

  it('creates a visible zone, a row and a seat, then moves a row with its seats', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const zone = createObjectAt(state.draft, 'zone', { x: 20, y: 20 });
    state = applyEditorCommand(state, zone.command);
    expect(state.draft.zoneBounds[zone.target.id]).toEqual({
      minX: 15,
      minY: 16,
      maxX: 25,
      maxY: 24,
    });

    const row = createObjectAt(
      state.draft,
      'row-line',
      { x: 20, y: 20 },
      zone.target.id,
    );
    state = applyEditorCommand(state, row.command);
    expect(state.draft.snapshot.rows[0]?.zoneId).toBe(zone.target.id);

    const seat = createObjectAt(
      state.draft,
      'seat',
      { x: 20, y: 20 },
      zone.target.id,
    );
    state = applyEditorCommand(state, seat.command);
    const moved = moveTarget(state.draft, seat.target, { x: 3, y: -2 });
    state = applyEditorCommand(state, moved);
    expect(state.draft.snapshot.seats[0]?.position).toEqual({ x: 23, y: 18 });
    expect(undoEditor(state).draft.snapshot.seats[0]?.position).toEqual({
      x: 20,
      y: 20,
    });
  });

  it('deletes a zone with its objects and undo restores them', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const zone = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, zone.command);
    const table = createObjectAt(
      state.draft,
      'table-circle',
      { x: 0, y: 0 },
      zone.target.id,
    );
    state = applyEditorCommand(state, table.command);
    state = applyEditorCommand(state, deleteTarget(state.draft, zone.target));
    expect(state.draft.snapshot.zones).toHaveLength(0);
    expect(state.draft.snapshot.tables).toHaveLength(0);
    expect(undoEditor(state).draft.snapshot.tables).toHaveLength(1);
  });

  it('moves the attached seats together with their row', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const row = createObjectAt(state.draft, 'row-line', { x: 10, y: 10 });
    state = applyEditorCommand(state, row.command);
    const seat = createObjectAt(state.draft, 'seat', { x: 10, y: 10 });
    state = applyEditorCommand(state, seat.command);
    const original = state.draft.snapshot.seats[0];
    if (!original) throw new Error('Missing seat');
    state = applyEditorCommand(state, {
      kind: 'update',
      patches: [
        {
          collection: 'seats',
          id: original.id,
          before: original,
          after: {
            ...original,
            placement: { kind: 'row', rowId: row.target.id as never },
          },
        },
      ],
    });

    state = applyEditorCommand(
      state,
      moveTarget(state.draft, row.target, { x: 5, y: -3 }),
    );
    expect(state.draft.snapshot.seats[0]?.position).toEqual({ x: 15, y: 7 });
    expect(undoEditor(state).draft.snapshot.seats[0]?.position).toEqual({
      x: 10,
      y: 10,
    });
  });

  it('deletes row seats even when the seat has no direct zone ID', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const zone = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, zone.command);
    const row = createObjectAt(
      state.draft,
      'row-line',
      { x: 0, y: 0 },
      zone.target.id,
    );
    state = applyEditorCommand(state, row.command);
    const seat = createObjectAt(state.draft, 'seat', { x: 0, y: 0 });
    state = applyEditorCommand(state, seat.command);
    const original = state.draft.snapshot.seats[0];
    if (!original) throw new Error('Missing seat');
    state = applyEditorCommand(state, {
      kind: 'update',
      patches: [
        {
          collection: 'seats',
          id: original.id,
          before: original,
          after: {
            ...original,
            placement: { kind: 'row', rowId: row.target.id as never },
          },
        },
      ],
    });

    state = applyEditorCommand(state, deleteTarget(state.draft, zone.target));
    expect(state.draft.snapshot.seats).toHaveLength(0);
  });

  it('moves a parent and its selected child once in one undoable command', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const zone = createObjectAt(state.draft, 'zone', { x: 10, y: 10 });
    state = applyEditorCommand(state, zone.command);
    const seat = createObjectAt(
      state.draft,
      'seat',
      { x: 10, y: 10 },
      zone.target.id,
    );
    state = applyEditorCommand(state, seat.command);
    const before = state.past.length;

    state = applyEditorCommand(
      state,
      moveTargets(state.draft, [zone.target, seat.target], { x: 4, y: -2 }),
    );

    expect(state.draft.snapshot.seats[0]?.position).toEqual({ x: 14, y: 8 });
    expect(state.draft.zoneBounds[zone.target.id]?.minX).toBe(9);
    expect(state.past).toHaveLength(before + 1);
    expect(undoEditor(state).draft.snapshot.seats[0]?.position).toEqual({
      x: 10,
      y: 10,
    });
  });

  it('deletes an entire multiselection once and undo restores it', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const first = createObjectAt(state.draft, 'seat', { x: 0, y: 0 });
    state = applyEditorCommand(state, first.command);
    const second = createObjectAt(state.draft, 'seat', { x: 4, y: 0 });
    state = applyEditorCommand(state, second.command);
    state = applyEditorCommand(
      state,
      deleteTargets(state.draft, [first.target, second.target]),
    );
    expect(state.draft.snapshot.seats).toHaveLength(0);
    expect(undoEditor(state).draft.snapshot.seats).toHaveLength(2);
  });

  it('does not add history for a zero-distance group move', () => {
    let state = createEditorState(createEmptyDraft('My hall'));
    const seat = createObjectAt(state.draft, 'seat', { x: 0, y: 0 });
    state = applyEditorCommand(state, seat.command);
    const result = applyEditorCommand(
      state,
      moveTargets(state.draft, [seat.target], { x: 0, y: 0 }),
    );
    expect(result).toBe(state);
  });
});

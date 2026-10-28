import { describe, expect, it } from 'vitest';
import { floorIdSchema } from '@hall-platform/domain';
import { createEmptyDraft } from './editorDraft.js';
import {
  applyEditorCommand,
  createEditorState,
  undoEditor,
} from './editorCommands.js';
import {
  alignTargets,
  createObjectAt,
  createStarterTemplate,
  deleteTarget,
  deleteTargets,
  distributeTargets,
  duplicateTargets,
  selectionCenterValue,
  setSelectionCenter,
  moveTarget,
  moveTargets,
} from './editorOperations.js';

describe('layout actions', () => {
  it('aligns selected seats in one undoable command', () => {
    let state = createEditorState(createEmptyDraft('Alignment'));
    const targets = [
      { x: 2, y: 1 },
      { x: 7, y: 4 },
      { x: 12, y: 8 },
    ].map((point) => {
      const created = createObjectAt(state.draft, 'seat', point);
      state = applyEditorCommand(state, created.command);
      return created.target;
    });
    const before = state.past.length;
    state = applyEditorCommand(
      state,
      alignTargets(state.draft, targets, 'top'),
    );
    expect(state.draft.snapshot.seats.map((seat) => seat.position.y)).toEqual([
      1, 1, 1,
    ]);
    expect(state.past).toHaveLength(before + 1);
    expect(
      undoEditor(state).draft.snapshot.seats.map((seat) => seat.position.y),
    ).toEqual([1, 4, 8]);
  });

  it('distributes selected seats evenly between outer centers', () => {
    let state = createEditorState(createEmptyDraft('Distribution'));
    const targets = [0, 2, 12].map((x) => {
      const created = createObjectAt(state.draft, 'seat', { x, y: 0 });
      state = applyEditorCommand(state, created.command);
      return created.target;
    });
    state = applyEditorCommand(
      state,
      distributeTargets(state.draft, targets, 'horizontal'),
    );
    expect(state.draft.snapshot.seats.map((seat) => seat.position.x)).toEqual([
      0, 6, 12,
    ]);
  });

  it('duplicates a row with its seats as one undoable selection', () => {
    let state = createEditorState(createEmptyDraft('Duplication'));
    const row = createObjectAt(state.draft, 'row-line', { x: 5, y: 5 });
    state = applyEditorCommand(state, row.command);
    const originalRow = state.draft.snapshot.rows[0];
    if (!originalRow || originalRow.curve.kind !== 'line')
      throw new Error('Missing original line row');
    const originalCount = state.draft.snapshot.seats.length;
    const copied = duplicateTargets(state.draft, [row.target], { x: 3, y: 2 });
    state = applyEditorCommand(state, copied.command);
    expect(state.draft.snapshot.rows).toHaveLength(2);
    expect(state.draft.snapshot.seats).toHaveLength(originalCount * 2);
    expect(copied.targets).toHaveLength(1);
    expect(copied.targets[0]?.id).not.toBe(row.target.id);
    const newRow = state.draft.snapshot.rows[1];
    if (!newRow || newRow.curve.kind !== 'line')
      throw new Error('Missing duplicated line row');
    expect(newRow.curve.start).toEqual({
      x: originalRow.curve.start.x + 3,
      y: originalRow.curve.start.y + 2,
    });
    expect(undoEditor(state).draft.snapshot.rows).toHaveLength(1);
  });

  it('duplicates a selected zone with dependent furniture once', () => {
    let state = createEditorState(createEmptyDraft('Zone copy'));
    const zone = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, zone.command);
    const row = createObjectAt(
      state.draft,
      'row-line',
      { x: 0, y: 0 },
      zone.target.id,
    );
    state = applyEditorCommand(state, row.command);
    const table = createObjectAt(
      state.draft,
      'table-circle',
      { x: 0, y: 3 },
      zone.target.id,
    );
    state = applyEditorCommand(state, table.command);
    const oldSeatCount = state.draft.snapshot.seats.length;
    const copied = duplicateTargets(
      state.draft,
      [zone.target, row.target, table.target],
      { x: 20, y: 0 },
    );
    state = applyEditorCommand(state, copied.command);
    expect(state.draft.snapshot.zones).toHaveLength(2);
    expect(state.draft.snapshot.rows).toHaveLength(2);
    expect(state.draft.snapshot.tables).toHaveLength(2);
    expect(state.draft.snapshot.seats).toHaveLength(oldSeatCount * 2);
    expect(
      new Set(state.draft.snapshot.seats.map((seat) => seat.id)).size,
    ).toBe(oldSeatCount * 2);
    expect(copied.targets).toHaveLength(1);
  });

  it('pastes copied furniture onto the active floor without a stale zone reference', () => {
    let state = createEditorState(createEmptyDraft('Two floors'));
    const zone = createObjectAt(state.draft, 'zone', { x: 0, y: 0 });
    state = applyEditorCommand(state, zone.command);
    const seat = createObjectAt(state.draft, 'seat', { x: 1, y: 2 }, zone.target.id);
    state = applyEditorCommand(state, seat.command);
    const source = state.draft;
    const secondFloor = floorIdSchema.parse('floor-upper');
    state = createEditorState({ ...state.draft, snapshot: { ...state.draft.snapshot, floors: [
      ...state.draft.snapshot.floors,
      { id: secondFloor, layoutVersionId: state.draft.snapshot.layoutVersionId, name: 'Балкон' },
    ] } });
    const copied = duplicateTargets(source, [seat.target], { x: 2, y: 2 }, secondFloor);
    state = applyEditorCommand(state, copied.command);
    expect(state.draft.snapshot.seats[1]?.floorId).toBe(secondFloor);
    expect(state.draft.snapshot.seats[1]?.zoneId).toBeUndefined();
  });

  it('shows mixed coordinate and sets all selected centers in one command', () => {
    let state = createEditorState(createEmptyDraft('Mixed'));
    const targets = [1, 4].map((x) => {
      const created = createObjectAt(state.draft, 'seat', { x, y: 2 });
      state = applyEditorCommand(state, created.command);
      return created.target;
    });
    expect(selectionCenterValue(state.draft, targets, 'x')).toBeNull();
    expect(selectionCenterValue(state.draft, targets, 'y')).toBe(2);
    const before = state.past.length;
    state = applyEditorCommand(
      state,
      setSelectionCenter(state.draft, targets, 'x', 10),
    );
    expect(state.draft.snapshot.seats.map((seat) => seat.position.x)).toEqual([
      10, 10,
    ]);
    expect(state.past).toHaveLength(before + 1);
  });

  it('starts a hall with stage, row, and table in one undoable action', () => {
    let state = createEditorState(createEmptyDraft('Start'));
    const template = createStarterTemplate(state.draft);
    state = applyEditorCommand(state, template.command);
    expect(
      state.draft.snapshot.decorations.some((item) => item.kind === 'stage'),
    ).toBe(true);
    expect(state.draft.snapshot.rows).toHaveLength(1);
    expect(state.draft.snapshot.tables).toHaveLength(1);
    expect(undoEditor(state).draft.snapshot.rows).toHaveLength(0);
  });
});

describe('editor tools', () => {
  it('creates a straight row with seats in one command (A03)', () => {
    const state = createEditorState(createEmptyDraft('My hall'));
    const row = createObjectAt(state.draft, 'row-line', { x: 10, y: 10 });
    const created = applyEditorCommand(state, row.command);
    expect(created.draft.snapshot.rows).toHaveLength(1);
    expect(created.draft.snapshot.seats.length).toBeGreaterThan(0);
  });

  it('creates a round table with seats in one command (A03)', () => {
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
    expect(
      state.draft.snapshot.seats.find(({ id }) => id === seat.target.id)
        ?.position,
    ).toEqual({ x: 23, y: 18 });
    expect(
      undoEditor(state).draft.snapshot.seats.find(
        ({ id }) => id === seat.target.id,
      )?.position,
    ).toEqual({
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
    const original = state.draft.snapshot.seats[0];
    if (!original) throw new Error('Missing seat');

    state = applyEditorCommand(
      state,
      moveTarget(state.draft, row.target, { x: 5, y: -3 }),
    );
    expect(
      state.draft.snapshot.seats.find(({ id }) => id === original.id)?.position,
    ).toEqual({ x: original.position.x + 5, y: original.position.y - 3 });
    expect(
      undoEditor(state).draft.snapshot.seats.find(
        ({ id }) => id === original.id,
      )?.position,
    ).toEqual({
      x: original.position.x,
      y: original.position.y,
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
    const original = state.draft.snapshot.seats.find(
      ({ id }) => id === seat.target.id,
    );
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

  it('does not add a generated-seat offset when the seat precedes its parent in selection', () => {
    let state = createEditorState(createEmptyDraft('Move group'));
    const row = createObjectAt(state.draft, 'row-line', { x: 0, y: 0 });
    state = applyEditorCommand(state, row.command);
    const seat = state.draft.snapshot.seats[0];
    if (!seat) throw new Error('Missing generated seat');
    const originalX = seat.position.x;
    state = applyEditorCommand(state, moveTargets(state.draft, [
      { kind: 'seat', id: seat.id }, row.target,
    ], { x: 3, y: 0 }));
    expect(state.draft.snapshot.seats[0]?.position.x).toBeCloseTo(originalX + 3);
    expect(state.draft.snapshot.seats[0]?.manual?.offset.x ?? 0).toBe(0);
    state = applyEditorCommand(state, moveTarget(state.draft, row.target, { x: 0, y: 0 }));
    expect(state.draft.snapshot.seats[0]?.position.x).toBeCloseTo(originalX + 3);
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

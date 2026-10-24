import { describe, expect, it } from 'vitest';
import { worldPointSchema } from '@hall-platform/domain';
import {
  createEditorState,
  applyEditorCommand,
  undoEditor,
} from '../editorCommands.js';
import { createEmptyDraft } from '../editorDraft.js';
import {
  createObjectAt,
  deleteTarget,
  deleteTargets,
  moveTarget,
} from '../editorOperations.js';
import { regenerateRowSeats, regenerateTableSeats } from './regenerateSeats.js';

describe('regenerate generated seats', () => {
  it.each(['row-line', 'table-circle'] as const)(
    'retains furniture kind when %s seats regenerate',
    (tool) => {
      let state = createEditorState(createEmptyDraft('Hall'));
      state = applyEditorCommand(
        state,
        createObjectAt(state.draft, tool, { x: 0, y: 0 }).command,
      );
      const first = state.draft.snapshot.seats[0];
      if (!first) throw new Error('Missing seat');
      const draft = {
        ...state.draft,
        snapshot: {
          ...state.draft.snapshot,
          seats: state.draft.snapshot.seats.map((seat) =>
            seat.id === first.id
              ? { ...seat, visualKind: 'armchair' as const }
              : seat,
          ),
        },
      };
      const row = draft.snapshot.rows[0];
      const table = draft.snapshot.tables[0];
      const command =
        tool === 'row-line'
          ? row
            ? regenerateRowSeats(draft, row, { ...row, name: 'Changed' })
            : null
          : table
            ? regenerateTableSeats(draft, table, { ...table, label: 'Changed' })
            : null;
      if (!command) throw new Error('Missing parent furniture');
      expect(
        command.patches.find(
          (patch) => patch.collection === 'seats' && patch.id === first.id,
        )?.after,
      ).toMatchObject({ visualKind: 'armchair' });
    },
  );

  it('points a table chair front toward the table center', () => {
    let state = createEditorState(createEmptyDraft('Hall'));
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'table-circle', { x: 0, y: 0 }).command,
    );
    const seat = state.draft.snapshot.seats[0];
    expect(seat?.position.x).toBeGreaterThan(0);
    expect(seat?.rotationRadians).toBeCloseTo(Math.PI / 2);
  });
  it('keeps row slot IDs, updates coordinates and undoes parent and seats together', () => {
    let state = createEditorState(createEmptyDraft('Theater'));
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'row-line', { x: 0, y: 0 }).command,
    );
    const row = state.draft.snapshot.rows[0];
    if (!row || row.curve.kind !== 'line') throw new Error('Missing line row');
    const ids = state.draft.snapshot.seats.map(({ id }) => id);
    const next = {
      ...row,
      curve: { ...row.curve, end: worldPointSchema.parse({ x: 12, y: 0 }) },
      generation: { distribution: { kind: 'even' as const, count: 10 } },
    };
    state = applyEditorCommand(
      state,
      regenerateRowSeats(state.draft, row, next),
    );

    expect(state.draft.snapshot.seats).toHaveLength(10);
    expect(state.draft.snapshot.seats.slice(0, 8).map(({ id }) => id)).toEqual(
      ids,
    );
    expect(state.draft.snapshot.seats[7]?.position.x).toBeGreaterThan(8);
    expect(undoEditor(state).draft.snapshot.seats.map(({ id }) => id)).toEqual(
      ids,
    );
  });

  it('preserves an individual row seat move through repeated regeneration', () => {
    let state = createEditorState(createEmptyDraft('Theater'));
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'row-line', { x: 0, y: 0 }).command,
    );
    const row = state.draft.snapshot.rows[0];
    const seat = state.draft.snapshot.seats[2];
    if (!row || row.curve.kind !== 'line' || !seat)
      throw new Error('Missing generated seat');
    state = applyEditorCommand(
      state,
      moveTarget(state.draft, { kind: 'seat', id: seat.id }, { x: 0, y: 2 }),
    );
    const widened = {
      ...row,
      curve: { ...row.curve, end: worldPointSchema.parse({ x: 12, y: 0 }) },
    };
    state = applyEditorCommand(
      state,
      regenerateRowSeats(state.draft, row, widened),
    );
    const moved = state.draft.snapshot.seats.find(({ id }) => id === seat.id);
    expect(moved?.position.y).toBe(2);

    state = applyEditorCommand(
      state,
      moveTarget(state.draft, { kind: 'seat', id: seat.id }, { x: 0, y: 1 }),
    );
    const wider = {
      ...widened,
      curve: { ...widened.curve, end: worldPointSchema.parse({ x: 16, y: 0 }) },
    };
    state = applyEditorCommand(
      state,
      regenerateRowSeats(state.draft, widened, wider),
    );
    expect(
      state.draft.snapshot.seats.find(({ id }) => id === seat.id)?.position.y,
    ).toBe(3);
  });

  it('regenerates a table when center and guest count change, retaining slots', () => {
    let state = createEditorState(createEmptyDraft('Banquet'));
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'table-circle', { x: 0, y: 0 }).command,
    );
    const table = state.draft.snapshot.tables[0];
    if (!table || table.shape.kind !== 'circle')
      throw new Error('Missing round table');
    const ids = state.draft.snapshot.seats.map(({ id }) => id);
    const next = {
      ...table,
      center: worldPointSchema.parse({ x: 10, y: 5 }),
      shape: { ...table.shape, seatCount: 8 },
    };
    state = applyEditorCommand(
      state,
      regenerateTableSeats(state.draft, table, next),
    );
    expect(state.draft.snapshot.seats).toHaveLength(8);
    expect(state.draft.snapshot.seats.slice(0, 6).map(({ id }) => id)).toEqual(
      ids,
    );
    expect(state.draft.snapshot.seats[0]?.position.x).toBeCloseTo(12.6);
    expect(undoEditor(state).draft.snapshot.seats.map(({ id }) => id)).toEqual(
      ids,
    );
  });

  it('does not revive a removed published seat when the row grows again', () => {
    let state = createEditorState(createEmptyDraft('Theater'));
    state = applyEditorCommand(
      state,
      createObjectAt(state.draft, 'row-line', { x: 0, y: 0 }).command,
    );
    const row = state.draft.snapshot.rows[0];
    const removedId = state.draft.snapshot.seats[7]?.id;
    if (!row || !removedId) throw new Error('Missing generated row');
    const publishedSeatIds = state.draft.snapshot.seats.map((seat) => seat.id);
    const smaller = {
      ...row,
      generation: { distribution: { kind: 'even' as const, count: 7 } },
    };
    state = applyEditorCommand(
      state,
      regenerateRowSeats(state.draft, row, smaller, { publishedSeatIds }),
    );
    const larger = {
      ...smaller,
      generation: { distribution: { kind: 'even' as const, count: 8 } },
    };
    state = applyEditorCommand(
      state,
      regenerateRowSeats(state.draft, smaller, larger, { publishedSeatIds }),
    );
    expect(state.draft.snapshot.seats).toHaveLength(8);
    expect(
      state.draft.snapshot.seats.some((seat) => seat.id === removedId),
    ).toBe(false);
  });

  it.each(['row-line', 'table-circle'] as const)(
    'keeps a deleted generated seat skipped after moving %s',
    (tool) => {
      let state = createEditorState(createEmptyDraft('Hall'));
      const created = createObjectAt(state.draft, tool, { x: 0, y: 0 });
      state = applyEditorCommand(state, created.command);
      const removed = state.draft.snapshot.seats[1];
      if (!removed) throw new Error('Missing seat');
      state = applyEditorCommand(
        state,
        deleteTarget(state.draft, { kind: 'seat', id: removed.id }),
      );
      expect(
        state.draft.snapshot.seats.some((seat) => seat.id === removed.id),
      ).toBe(false);
      const count = state.draft.snapshot.seats.length;
      state = applyEditorCommand(
        state,
        moveTarget(state.draft, created.target, { x: 5, y: 0 }),
      );
      expect(state.draft.snapshot.seats).toHaveLength(count);
      expect(
        state.draft.snapshot.seats.some((seat) => seat.id === removed.id),
      ).toBe(false);
    },
  );

  it('skips two selected generated seats in one command', () => {
    let state = createEditorState(createEmptyDraft('Hall'));
    const created = createObjectAt(state.draft, 'row-line', { x: 0, y: 0 });
    state = applyEditorCommand(state, created.command);
    const first = state.draft.snapshot.seats[1];
    const second = state.draft.snapshot.seats[3];
    if (!first || !second) throw new Error('Missing seats');
    state = applyEditorCommand(
      state,
      deleteTargets(state.draft, [
        { kind: 'seat', id: first.id },
        { kind: 'seat', id: second.id },
      ]),
    );
    expect(state.draft.snapshot.seats).toHaveLength(6);
    state = applyEditorCommand(
      state,
      moveTarget(state.draft, created.target, { x: 1, y: 0 }),
    );
    expect(state.draft.snapshot.seats).toHaveLength(6);
  });
});

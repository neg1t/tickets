import { describe, expect, it } from 'vitest';
import {
  backgroundSchema,
  rowSchema,
  seatIdSchema,
  seatSchema,
  type Seat,
  worldPointSchema,
} from '@hall-platform/domain';
import { createEmptyDraft } from './editorDraft.js';
import {
  applyEditorCommand,
  createEditorState,
  redoEditor,
  undoEditor,
} from './editorCommands.js';
import { createObjectAt } from './editorOperations.js';

function largeSeatDraft(count = 10_000) {
  const draft = createEmptyDraft('Large hall');
  const floorId = draft.snapshot.floors[0]?.id;
  if (!floorId) throw new Error('Missing floor');
  const seed = seatSchema.parse({
    id: 'seat-seed',
    floorId,
    label: '1',
    position: { x: 0, y: 0 },
    placement: { kind: 'standalone' },
  });
  return {
    ...draft,
    snapshot: {
      ...draft.snapshot,
      seats: Array.from({ length: count }, (_, index) => ({
        ...seed,
        id: seatIdSchema.parse(`seat-${index}`),
        position: worldPointSchema.parse({ x: index, y: 0 }),
      })),
    },
  };
}

describe('editor commands', () => {
  it('moves one seat in a 10k draft without cloning untouched entities', () => {
    const draft = largeSeatDraft();
    const before = draft.snapshot.seats[0];
    if (!before) throw new Error('Missing seat');
    const next = applyEditorCommand(createEditorState(draft), {
      kind: 'move',
      patches: [{
        collection: 'seats',
        id: before.id,
        before,
        after: { ...before, position: worldPointSchema.parse({ x: 4, y: 5 }) },
      }],
    });

    expect(next.draft.snapshot.seats[0]?.position).toEqual({ x: 4, y: 5 });
    expect(next.draft.snapshot.seats[9_999]).toBe(draft.snapshot.seats[9_999]);
    expect(next.draft.snapshot.rows).toBe(draft.snapshot.rows);
    expect(undoEditor(next).draft.snapshot.seats[0]).toBe(before);
  });

  it('rejects malformed geometry in an otherwise local move', () => {
    const draft = largeSeatDraft(1);
    const before = draft.snapshot.seats[0];
    if (!before) throw new Error('Missing seat');
    expect(() => applyEditorCommand(createEditorState(draft), {
      kind: 'move',
      patches: [{
        collection: 'seats',
        id: before.id,
        before,
        after: { ...before, position: { x: Number.POSITIVE_INFINITY, y: 0 } as typeof before.position },
      }],
    })).toThrow();
  });

  it('applies a group move in a 10k draft while retaining untouched seats', () => {
    const draft = largeSeatDraft();
    const patches = draft.snapshot.seats.slice(0, 2_048).map((before) => ({
      collection: 'seats' as const,
      id: before.id,
      before,
      after: { ...before, position: worldPointSchema.parse({ x: before.position.x + 3, y: 2 }) },
    }));
    const started = performance.now();
    const next = applyEditorCommand(createEditorState(draft), {
      kind: 'move', patches,
    });
    const elapsed = performance.now() - started;
    console.info(`10k draft, 2048-seat group move: ${elapsed.toFixed(1)} ms`);

    expect(next.draft.snapshot.seats[2_047]?.position.y).toBe(2);
    expect(next.draft.snapshot.seats[9_999]).toBe(draft.snapshot.seats[9_999]);
    expect(elapsed).toBeLessThan(500);
  }, 20_000);

  it('measures command application for 1, 100, 500 and 1000 patches', () => {
    const draft = largeSeatDraft(50_000);
    const state = createEditorState(draft);
    for (const count of [1, 100, 500, 1_000]) {
      const patches = draft.snapshot.seats.slice(0, count).map((before) => ({
        collection: 'seats' as const,
        id: before.id,
        before,
        after: {
          ...before,
          position: worldPointSchema.parse({
            x: before.position.x + 0.25,
            y: before.position.y + 0.25,
          }),
        },
      }));
      const apply = () =>
        applyEditorCommand(state, { kind: 'update', patches });
      apply();
      const samples = Array.from({ length: 3 }, () => {
        const started = performance.now();
        const next = apply();
        const elapsed = performance.now() - started;
        expect(next.draft.snapshot.seats[count - 1]?.position.x).toBe(
          count - 1 + 0.25,
        );
        return elapsed;
      });
      const median = [...samples].sort((left, right) => left - right)[1];
      console.info(
        `50k draft, ${count} update patches: median ${median?.toFixed(1)} ms across 3 runs`,
      );
    }
  }, 20_000);

  it('measures structural command batches for 1, 100, 500 and 1000 patches', () => {
    const draft = largeSeatDraft(50_000);
    const state = createEditorState(draft);
    const seed = draft.snapshot.seats[0];
    if (!seed) throw new Error('Missing seed seat');

    for (const count of [1, 100, 500, 1_000]) {
      const deleteCount = Math.floor(count / 2);
      const createCount = count - deleteCount;
      const patches = [
        ...draft.snapshot.seats.slice(0, deleteCount).map((before) => ({
          collection: 'seats' as const,
          id: before.id,
          before,
          after: null,
        })),
        ...Array.from({ length: createCount }, (_, index) => {
          const after = seatSchema.parse({
            ...seed,
            id: seatIdSchema.parse(`seat-bench-${count}-${index}`),
            label: `Bench ${count}-${index}`,
            position: worldPointSchema.parse({ x: 100_000 + index, y: 0 }),
          });
          return {
            collection: 'seats' as const,
            id: after.id,
            before: null,
            after,
          };
        }),
      ];
      const apply = () =>
        applyEditorCommand(state, { kind: 'update', patches });
      apply();
      const samples = Array.from({ length: 3 }, () => {
        const started = performance.now();
        const next = apply();
        const elapsed = performance.now() - started;
        expect(next.draft.snapshot.seats).toHaveLength(
          50_000 - deleteCount + createCount,
        );
        return elapsed;
      });
      const median = [...samples].sort((left, right) => left - right)[1];
      console.info(
        `50k draft, ${count} structural patches: median ${median?.toFixed(1)} ms across 3 runs`,
      );
    }
  }, 20_000);

  it('still rejects a move that changes a seat to a missing floor', () => {
    const draft = largeSeatDraft(1);
    const before = draft.snapshot.seats[0];
    if (!before) throw new Error('Missing seat');
    expect(() => applyEditorCommand(createEditorState(draft), {
      kind: 'move',
      patches: [{
        collection: 'seats',
        id: before.id,
        before,
        after: { ...before, floorId: 'missing' as typeof before.floorId },
      }],
    })).toThrow();
  });
  it('undoes a PDF background import and calibration without moving a seat', () => {
    const initial = createEditorState(createEmptyDraft('Test Hall'));
    const floorId = initial.draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const asset = {
      kind: 'pdf' as const,
      name: 'plan.pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      pages: [{ width: 200, height: 100 }],
    };
    const background = backgroundSchema.parse({
      id: 'background-1',
      floorId,
      order: 0,
      position: worldPointSchema.parse({ x: 5, y: 7 }),
      scale: 0.5,
      rotationRadians: 0,
      opacity: 1,
      visible: true,
      locked: false,
      source: { kind: 'pdf' as const, assetId: 'plan', pageNumber: 1 },
    });
    const imported = applyEditorCommand(initial, {
      kind: 'create',
      patches: [
        { collection: 'assets', id: 'plan', before: null, after: asset },
        {
          collection: 'backgrounds',
          id: background.id,
          before: null,
          after: background,
        },
      ],
    });
    const calibrated = applyEditorCommand(imported, {
      kind: 'update',
      patches: [
        {
          collection: 'calibration',
          before: null,
          after: { millimetersPerWorldUnit: 25 },
        },
      ],
    });
    expect(calibrated.draft.calibration?.millimetersPerWorldUnit).toBe(25);
    expect(undoEditor(calibrated).draft.calibration).toBeNull();
    expect(
      undoEditor(undoEditor(calibrated)).draft.snapshot.backgrounds,
    ).toHaveLength(0);
    expect(
      redoEditor(undoEditor(calibrated)).draft.calibration
        ?.millimetersPerWorldUnit,
    ).toBe(25);
  });

  it('creates a seat, changes its position, and restores both steps', () => {
    const initial = createEditorState(createEmptyDraft('Test Hall'));
    const floorId = initial.draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const seat = seatSchema.parse({
      id: 'seat-1',
      floorId,
      label: '1',
      position: { x: 4, y: 5 },
      placement: { kind: 'standalone' },
    });
    const created = applyEditorCommand(initial, {
      kind: 'create',
      patches: [
        { collection: 'seats', id: seat.id, before: null, after: seat },
      ],
    });
    expect(created.draft.snapshot.seats[0]?.position).toEqual({ x: 4, y: 5 });

    const moved = applyEditorCommand(created, {
      kind: 'update',
      patches: [
        {
          collection: 'seats',
          id: seat.id,
          before: seat,
          after: { ...seat, position: worldPointSchema.parse({ x: 9, y: 7 }) },
        },
      ],
    });
    expect(moved.draft.snapshot.seats[0]?.position).toEqual({ x: 9, y: 7 });
    expect(undoEditor(moved).draft.snapshot.seats[0]?.position).toEqual({
      x: 4,
      y: 5,
    });
    expect(undoEditor(undoEditor(moved)).draft.snapshot.seats).toHaveLength(0);
    expect(
      redoEditor(undoEditor(moved)).draft.snapshot.seats[0]?.position,
    ).toEqual({ x: 9, y: 7 });
  });

  it('applies grouped collection changes in order and preserves undo/redo indexes', () => {
    const draft = largeSeatDraft(4);
    const [first, second, third, fourth] = draft.snapshot.seats;
    if (!first || !second || !third || !fourth)
      throw new Error('Missing seed seats');
    const inserted = seatSchema.parse({
      ...first,
      id: 'seat-inserted',
      label: 'Inserted',
      position: { x: 20, y: 1 },
    });
    const appended = seatSchema.parse({
      ...first,
      id: 'seat-appended',
      label: 'Appended',
      position: { x: 30, y: 1 },
    });
    const negativeIndexed = seatSchema.parse({
      ...first,
      id: 'seat-negative-index',
      label: 'Negative index',
      position: { x: 25, y: 1 },
    });
    const command = {
      kind: 'update' as const,
      patches: [
        { collection: 'seats' as const, id: third.id, before: third, after: null, index: 2 },
        { collection: 'seats' as const, id: inserted.id, before: null, after: inserted, index: 1 },
        { collection: 'seats' as const, id: second.id, before: second, after: { ...second, label: 'Updated' } },
        { collection: 'seats' as const, id: negativeIndexed.id, before: null, after: negativeIndexed, index: -1 },
        { collection: 'seats' as const, id: appended.id, before: null, after: appended },
      ],
    };
    const applied = applyEditorCommand(createEditorState(draft), command);
    expect(applied.draft.snapshot.seats.map((seat) => seat.id)).toEqual([
      first.id,
      inserted.id,
      second.id,
      negativeIndexed.id,
      fourth.id,
      appended.id,
    ]);
    expect(applied.draft.snapshot.seats[2]?.label).toBe('Updated');

    const undone = undoEditor(applied);
    expect(undone.draft.snapshot.seats.map((seat) => seat.id)).toEqual(
      draft.snapshot.seats.map((seat) => seat.id),
    );
    expect(undone.draft.snapshot.seats[1]).toEqual(second);
    expect(redoEditor(undone).draft.snapshot.seats.map((seat) => seat.id)).toEqual(
      applied.draft.snapshot.seats.map((seat) => seat.id),
    );
  });

  it('still validates the complete draft when applying a malformed create patch', () => {
    const initial = createEditorState(createEmptyDraft('Test Hall'));
    const floorId = initial.draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const malformed = {
      id: 'seat-invalid',
      floorId,
      label: 'Invalid',
      position: { x: Number.POSITIVE_INFINITY, y: 0 },
      placement: { kind: 'standalone' as const },
    } as unknown as Seat;

    expect(() =>
      applyEditorCommand(initial, {
        kind: 'create',
        patches: [
          {
            collection: 'seats',
            id: malformed.id,
            before: null,
            after: malformed,
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects a row linked to a missing zone without changing the draft', () => {
    const initial = createEditorState(createEmptyDraft('Test Hall'));
    const floorId = initial.draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const row = rowSchema.parse({
      id: 'row-1',
      floorId,
      zoneId: 'missing',
      name: 'A',
      curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    });
    expect(() =>
      applyEditorCommand(initial, {
        kind: 'create',
        patches: [{ collection: 'rows', id: row.id, before: null, after: row }],
      }),
    ).toThrow();
    expect(initial.draft.snapshot.rows).toHaveLength(0);
  });

  it('rejects inverted zone bounds from the properties panel', () => {
    const initial = createEditorState(createEmptyDraft('Test Hall'));
    const zone = createObjectAt(initial.draft, 'zone', { x: 0, y: 0 });
    const created = applyEditorCommand(initial, zone.command);
    const before = created.draft.zoneBounds[zone.target.id];
    if (!before) throw new Error('Missing zone bounds');

    expect(() =>
      applyEditorCommand(created, {
        kind: 'update',
        patches: [
          {
            collection: 'zoneBounds',
            id: zone.target.id,
            before,
            after: { ...before, maxX: before.minX - 1 },
          },
        ],
      }),
    ).toThrow();
  });
});

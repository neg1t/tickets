import { describe, expect, it } from 'vitest';
import {
  backgroundSchema,
  rowSchema,
  seatIdSchema,
  seatSchema,
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

import {
  layoutDocumentSchema,
  rowCurveSchema,
  worldPointSchema,
} from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import banquetHall from '@hall-platform/fixtures/banquet-hall.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

import { buildHallScene, targetBounds } from './hallScene.js';
import {
  boxSelectedTargets,
  editHandleGeometry,
  gridStepForScale,
  handlesForTarget,
  hitHandle,
  shouldStartBoxSelection,
  snapPoint,
  snappedMoveDelta,
} from './directManipulation.js';

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
const banquetSnapshot = layoutDocumentSchema.parse(
  banquetHall.document,
).snapshot;

describe('direct canvas manipulation', () => {
  it('selects only targets enclosed by a dragged box', () => {
    const seat = snapshot.seats[0];
    if (!seat) throw new Error('Missing fixture seat');
    const scene = buildHallScene(snapshot, seat.floorId);
    const bounds = targetBounds(scene, { kind: 'seat', id: seat.id });
    if (!bounds) throw new Error('Missing seat bounds');
    const selection = boxSelectedTargets(scene, {
      minX: bounds.minX - 0.1,
      minY: bounds.minY - 0.1,
      maxX: bounds.maxX + 0.1,
      maxY: bounds.maxY + 0.1,
    });
    expect(selection).toContainEqual({ kind: 'seat', id: seat.id });
    expect(selection).not.toContainEqual({ kind: 'zone', id: seat.zoneId });
  });

  it('starts a marquee from empty canvas or an unselected zone interior', () => {
    const zone = { kind: 'zone' as const, id: 'zone-1' };
    expect(shouldStartBoxSelection(null, false, false)).toBe(true);
    expect(shouldStartBoxSelection(zone, false, false)).toBe(true);
    expect(shouldStartBoxSelection(zone, true, false)).toBe(false);
    expect(shouldStartBoxSelection(zone, true, true)).toBe(true);
    expect(
      shouldStartBoxSelection({ kind: 'seat', id: 'seat-1' }, false, false),
    ).toBe(false);
  });

  it('offers row curve handles and hits them in screen-sized tolerance', () => {
    const row = snapshot.rows[0];
    if (!row) throw new Error('Missing fixture row');
    const scene = buildHallScene(snapshot, row.floorId);
    const handles = handlesForTarget(scene, { kind: 'row', id: row.id });
    expect(handles.length).toBeGreaterThanOrEqual(2);
    const first = handles[0];
    if (!first) throw new Error('Missing handle');
    expect(
      hitHandle(handles, { x: first.point.x + 0.1, y: first.point.y }, 0.2)?.id,
    ).toBe(first.id);
  });

  it('keeps the arc radius handle separate from its angle handles', () => {
    const row = snapshot.rows[0];
    if (!row) throw new Error('Missing fixture row');
    const arc = {
      ...row,
      curve: rowCurveSchema.parse({
        kind: 'arc',
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: Math.PI,
      }),
    };
    const scene = buildHallScene({ ...snapshot, rows: [arc] }, row.floorId);
    const handles = handlesForTarget(scene, { kind: 'row', id: row.id });
    const start = handles.find((handle) => handle.id === 'startAngle');
    const radius = handles.find((handle) => handle.id === 'radius');
    expect(start?.point).not.toEqual(radius?.point);
    if (!start) throw new Error('Missing start angle handle');
    expect(hitHandle(handles, start.point, 0.01)?.id).toBe('startAngle');
  });

  it('offers bounding box handles for polygon zones and previews their resize', () => {
    const zone = snapshot.zones[0];
    if (!zone) throw new Error('Missing fixture zone');
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ].map((point) => worldPointSchema.parse(point));
    const source = { ...snapshot, zones: [{ ...zone, polygon }] };
    const scene = buildHallScene(source, zone.floorId);
    expect(
      handlesForTarget(scene, { kind: 'zone', id: zone.id }).map(
        (handle) => handle.id,
      ),
    ).toEqual(['bounds:nw', 'bounds:ne', 'bounds:se', 'bounds:sw']);
    const preview = editHandleGeometry(
      source,
      { [zone.id]: { minX: 0, minY: 0, maxX: 10, maxY: 10 } },
      { kind: 'zone', id: zone.id },
      'bounds:se',
      { x: 15, y: 20 },
    );
    expect(preview.snapshot.zones[0]?.polygon).toEqual([
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 0, y: 20 },
    ]);
    expect(source.zones[0]?.polygon).toEqual(polygon);
  });

  it('previews line, bezier, arc, table, and zone edits without mutating input', () => {
    const row = snapshot.rows[0];
    const table = banquetSnapshot.tables[0];
    const zone = snapshot.zones[0];
    if (!row || !table || !zone) throw new Error('Missing fixture geometry');
    const line = {
      ...row,
      curve: rowCurveSchema.parse({
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      }),
    };
    const bezier = {
      ...row,
      curve: rowCurveSchema.parse({
        kind: 'bezier',
        p0: { x: 0, y: 0 },
        p1: { x: 2, y: 1 },
        p2: { x: 8, y: 1 },
        p3: { x: 10, y: 0 },
      }),
    };
    const arc = {
      ...row,
      curve: rowCurveSchema.parse({
        kind: 'arc',
        center: { x: 0, y: 0 },
        radius: 5,
        startAngle: 0,
        endAngle: Math.PI,
      }),
    };
    const source = { ...snapshot, rows: [line, bezier, arc] };
    expect(
      editHandleGeometry(source, {}, { kind: 'row', id: row.id }, 'end', {
        x: 12,
        y: 2,
      }).snapshot.rows[0]?.curve,
    ).toMatchObject({ end: { x: 12, y: 2 } });
    expect(
      editHandleGeometry(
        { ...snapshot, rows: [bezier] },
        {},
        { kind: 'row', id: row.id },
        'control1',
        { x: 3, y: 4 },
      ).snapshot.rows[0]?.curve,
    ).toMatchObject({ p1: { x: 3, y: 4 } });
    expect(
      editHandleGeometry(
        { ...snapshot, rows: [arc] },
        {},
        { kind: 'row', id: row.id },
        'radius',
        { x: 0, y: 9 },
      ).snapshot.rows[0]?.curve,
    ).toMatchObject({ radius: 9 });
    expect(
      editHandleGeometry(
        banquetSnapshot,
        {},
        { kind: 'table', id: table.id },
        'rotate',
        { x: table.center.x, y: table.center.y + 10 },
      ).snapshot.tables[0]?.rotationRadians,
    ).toBeCloseTo(Math.PI / 2);
    const bounds = { [zone.id]: { minX: 0, minY: 0, maxX: 10, maxY: 10 } };
    expect(
      editHandleGeometry(
        snapshot,
        bounds,
        { kind: 'zone', id: zone.id },
        'bounds:se',
        { x: 15, y: 14 },
      ).zoneBounds[zone.id],
    ).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 14 });
    expect(line.curve).toMatchObject({ end: { x: 10, y: 0 } });
    expect(bounds[zone.id]?.maxX).toBe(10);
  });

  it('moves generated seats during row and table handle previews', () => {
    const row = snapshot.rows.find((item) => item.curve.kind === 'line');
    const table = banquetSnapshot.tables[0];
    if (!row || !table || row.curve.kind !== 'line')
      throw new Error('Missing fixture geometry');
    const rowSeat = snapshot.seats
      .filter(
        (seat) =>
          seat.placement.kind === 'row' && seat.placement.rowId === row.id,
      )
      .at(-1);
    const tableSeat = banquetSnapshot.seats.find(
      (seat) =>
        seat.placement.kind === 'table' && seat.placement.tableId === table.id,
    );
    if (!rowSeat || !tableSeat)
      throw new Error('Missing generated fixture seats');
    const stretched = editHandleGeometry(
      snapshot,
      {},
      { kind: 'row', id: row.id },
      'end',
      { x: row.curve.end.x + 10, y: row.curve.end.y + 10 },
    );
    const sized = editHandleGeometry(
      banquetSnapshot,
      {},
      { kind: 'table', id: table.id },
      'size',
      { x: table.center.x + 15, y: table.center.y + 15 },
    );
    expect(
      stretched.snapshot.seats.find((seat) => seat.id === rowSeat.id)?.position,
    ).not.toEqual(rowSeat.position);
    expect(
      sized.snapshot.seats.find((seat) => seat.id === tableSeat.id)?.position,
    ).not.toEqual(tableSeat.position);
    expect(
      snapshot.seats.find((seat) => seat.id === rowSeat.id)?.position,
    ).toEqual(rowSeat.position);
  });

  it('snaps points and move deltas to one world unit', () => {
    expect(snapPoint({ x: 2.49, y: -2.51 }, true)).toEqual({ x: 2, y: -3 });
    expect(snapPoint({ x: 2.49, y: -2.51 }, false)).toEqual({
      x: 2.49,
      y: -2.51,
    });
    expect(
      snappedMoveDelta({ x: 0.2, y: 0.2 }, { x: 1.8, y: 2.9 }, true),
    ).toEqual({ x: 2, y: 3 });
  });

  it('shows the one-unit grid at working zoom and major lines when zoomed out', () => {
    expect(gridStepForScale(4)).toBe(1);
    expect(gridStepForScale(1)).toBe(10);
    expect(gridStepForScale(0.1)).toBe(100);
  });

  it('does not offer rotation handles for circular seats', () => {
    const seat = snapshot.seats[0];
    if (!seat) throw new Error('Missing seat');
    const scene = buildHallScene(snapshot, seat.floorId);
    expect(
      handlesForTarget(scene, { kind: 'seat', id: seat.id }).map(
        (handle) => handle.id,
      ),
    ).toEqual([]);
  });
});

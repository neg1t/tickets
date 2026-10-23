import {
  rowIdSchema,
  seatIdSchema,
  tableIdSchema,
  zoneIdSchema,
  worldPointSchema,
  type WorldPoint,
  type Row,
  type Seat,
  type Table,
  type Zone,
} from '@hall-platform/domain';
import type { Vector2, SpatialBounds } from '@hall-platform/geometry';
import type { HallTarget } from '@hall-platform/renderer-konva';
import type { EditorCommand, EditorPatch } from './editorCommands.js';
import type { HallLayoutDraft } from './editorDraft.js';

export type EditorTool =
  | 'select'
  | 'pan'
  | 'zone'
  | 'row-line'
  | 'row-arc'
  | 'row-bezier'
  | 'seat'
  | 'table-circle'
  | 'table-rectangle'
  | 'calibrate';

function translated(point: Vector2, delta: Vector2): WorldPoint {
  return worldPointSchema.parse({ x: point.x + delta.x, y: point.y + delta.y });
}

function moveRow(row: Row, delta: Vector2): Row {
  const curve = row.curve;
  switch (curve.kind) {
    case 'line':
      return {
        ...row,
        curve: {
          ...curve,
          start: translated(curve.start, delta),
          end: translated(curve.end, delta),
        },
      };
    case 'arc':
      return {
        ...row,
        curve: { ...curve, center: translated(curve.center, delta) },
      };
    case 'bezier':
      return {
        ...row,
        curve: {
          ...curve,
          p0: translated(curve.p0, delta),
          p1: translated(curve.p1, delta),
          p2: translated(curve.p2, delta),
          p3: translated(curve.p3, delta),
        },
      };
    case 'polyline':
      return {
        ...row,
        curve: {
          ...curve,
          points: curve.points.map((point) => translated(point, delta)),
        },
      };
  }
}

function zoneReference(zoneId?: string): { zoneId?: Zone['id'] } {
  return zoneId ? { zoneId: zoneIdSchema.parse(zoneId) } : {};
}

export function createObjectAt(
  draft: HallLayoutDraft,
  tool: EditorTool,
  point: Vector2,
  zoneId?: string,
  activeFloorId?: string,
): { command: EditorCommand; target: HallTarget } {
  const floorId = activeFloorId
    ? draft.snapshot.floors.find((floor) => floor.id === activeFloorId)?.id
    : draft.snapshot.floors[0]?.id;
  if (!floorId) throw new Error('Draft requires a floor');
  if (
    zoneId &&
    !draft.snapshot.zones.some(
      (zone) => zone.id === zoneId && zone.floorId === floorId,
    )
  ) {
    throw new Error('Selected zone is not on the active floor');
  }
  const id = crypto.randomUUID();
  switch (tool) {
    case 'zone': {
      const zone: Zone = {
        id: zoneIdSchema.parse(`zone-${id}`),
        floorId,
        name: `Зона ${draft.snapshot.zones.length + 1}`,
      };
      const bounds: SpatialBounds = {
        minX: point.x - 5,
        minY: point.y - 4,
        maxX: point.x + 5,
        maxY: point.y + 4,
      };
      return {
        target: { kind: 'zone', id: zone.id },
        command: {
          kind: 'create',
          patches: [
            { collection: 'zones', id: zone.id, before: null, after: zone },
            {
              collection: 'zoneBounds',
              id: zone.id,
              before: null,
              after: bounds,
            },
          ],
        },
      };
    }
    case 'row-line':
    case 'row-arc':
    case 'row-bezier': {
      const curve: Row['curve'] =
        tool === 'row-line'
          ? {
              kind: 'line',
              start: worldPointSchema.parse({ x: point.x - 4, y: point.y }),
              end: worldPointSchema.parse({ x: point.x + 4, y: point.y }),
            }
          : tool === 'row-arc'
            ? {
                kind: 'arc',
                center: worldPointSchema.parse(point),
                radius: 4,
                startAngle: 0,
                endAngle: Math.PI,
              }
            : {
                kind: 'bezier',
                p0: worldPointSchema.parse({ x: point.x - 4, y: point.y }),
                p1: worldPointSchema.parse({ x: point.x - 2, y: point.y - 2 }),
                p2: worldPointSchema.parse({ x: point.x + 2, y: point.y - 2 }),
                p3: worldPointSchema.parse({ x: point.x + 4, y: point.y }),
              };
      const row: Row = {
        id: rowIdSchema.parse(`row-${id}`),
        floorId,
        ...zoneReference(zoneId),
        name: `Ряд ${draft.snapshot.rows.length + 1}`,
        curve,
      };
      return {
        target: { kind: 'row', id: row.id },
        command: {
          kind: 'create',
          patches: [
            { collection: 'rows', id: row.id, before: null, after: row },
          ],
        },
      };
    }
    case 'seat': {
      const seat: Seat = {
        id: seatIdSchema.parse(`seat-${id}`),
        floorId,
        ...zoneReference(zoneId),
        label: `${draft.snapshot.seats.length + 1}`,
        position: worldPointSchema.parse(point),
        placement: { kind: 'standalone' },
      };
      return {
        target: { kind: 'seat', id: seat.id },
        command: {
          kind: 'create',
          patches: [
            { collection: 'seats', id: seat.id, before: null, after: seat },
          ],
        },
      };
    }
    case 'table-circle':
    case 'table-rectangle': {
      const shape: Table['shape'] =
        tool === 'table-circle'
          ? { kind: 'circle', radius: 2, seatCount: 0 }
          : {
              kind: 'rectangle',
              width: 5,
              height: 3,
              seatsPerSide: { top: 0, right: 0, bottom: 0, left: 0 },
            };
      const table: Table = {
        id: tableIdSchema.parse(`table-${id}`),
        floorId,
        ...zoneReference(zoneId),
        label: `Стол ${draft.snapshot.tables.length + 1}`,
        center: worldPointSchema.parse(point),
        rotationRadians: 0,
        shape,
      };
      return {
        target: { kind: 'table', id: table.id },
        command: {
          kind: 'create',
          patches: [
            { collection: 'tables', id: table.id, before: null, after: table },
          ],
        },
      };
    }
    default:
      throw new Error(`Tool ${tool} cannot create an object`);
  }
}

export function moveTarget(
  draft: HallLayoutDraft,
  target: HallTarget,
  delta: Vector2,
): EditorCommand {
  const patches: EditorPatch[] = [];
  const { snapshot } = draft;
  function moveSeat(seat: Seat): void {
    patches.push({
      collection: 'seats',
      id: seat.id,
      before: seat,
      after: { ...seat, position: translated(seat.position, delta) },
    });
  }
  function moveTable(table: Table): void {
    patches.push({
      collection: 'tables',
      id: table.id,
      before: table,
      after: { ...table, center: translated(table.center, delta) },
    });
  }
  function moveRowPatch(row: Row): void {
    patches.push({
      collection: 'rows',
      id: row.id,
      before: row,
      after: moveRow(row, delta),
    });
  }
  switch (target.kind) {
    case 'seat': {
      const seat = snapshot.seats.find((item) => item.id === target.id);
      if (seat) moveSeat(seat);
      break;
    }
    case 'table': {
      const table = snapshot.tables.find((item) => item.id === target.id);
      if (table) moveTable(table);
      snapshot.seats
        .filter(
          (seat) =>
            seat.placement.kind === 'table' &&
            seat.placement.tableId === target.id,
        )
        .forEach(moveSeat);
      break;
    }
    case 'row': {
      const row = snapshot.rows.find((item) => item.id === target.id);
      if (row) moveRowPatch(row);
      snapshot.seats
        .filter(
          (seat) =>
            seat.placement.kind === 'row' && seat.placement.rowId === target.id,
        )
        .forEach(moveSeat);
      break;
    }
    case 'zone': {
      const bounds = draft.zoneBounds[target.id];
      if (bounds)
        patches.push({
          collection: 'zoneBounds',
          id: target.id,
          before: bounds,
          after: {
            minX: bounds.minX + delta.x,
            maxX: bounds.maxX + delta.x,
            minY: bounds.minY + delta.y,
            maxY: bounds.maxY + delta.y,
          },
        });
      const rows = snapshot.rows.filter((row) => row.zoneId === target.id);
      const tables = snapshot.tables.filter(
        (table) => table.zoneId === target.id,
      );
      const rowIds = new Set(rows.map((row) => row.id));
      const tableIds = new Set(tables.map((table) => table.id));
      rows.forEach(moveRowPatch);
      tables.forEach(moveTable);
      snapshot.seats
        .filter(
          (seat) =>
            seat.zoneId === target.id ||
            (seat.placement.kind === 'row' &&
              rowIds.has(seat.placement.rowId)) ||
            (seat.placement.kind === 'table' &&
              tableIds.has(seat.placement.tableId)),
        )
        .forEach(moveSeat);
      break;
    }
  }
  return { kind: 'move', patches };
}

export function deleteTarget(
  draft: HallLayoutDraft,
  target: HallTarget,
): EditorCommand {
  const patches: EditorPatch[] = [];
  const { snapshot } = draft;
  const removeSeat = (seat: Seat) =>
    patches.push({
      collection: 'seats',
      id: seat.id,
      before: seat,
      after: null,
    } as const);
  const removeRow = (row: Row) =>
    patches.push({
      collection: 'rows',
      id: row.id,
      before: row,
      after: null,
    } as const);
  const removeTable = (table: Table) =>
    patches.push({
      collection: 'tables',
      id: table.id,
      before: table,
      after: null,
    } as const);
  if (target.kind === 'zone') {
    const rows = snapshot.rows.filter((row) => row.zoneId === target.id);
    const tables = snapshot.tables.filter(
      (table) => table.zoneId === target.id,
    );
    const rowIds = new Set(rows.map((row) => row.id));
    const tableIds = new Set(tables.map((table) => table.id));
    snapshot.seats
      .filter(
        (seat) =>
          seat.zoneId === target.id ||
          (seat.placement.kind === 'row' && rowIds.has(seat.placement.rowId)) ||
          (seat.placement.kind === 'table' &&
            tableIds.has(seat.placement.tableId)),
      )
      .forEach(removeSeat);
    rows.forEach(removeRow);
    tables.forEach(removeTable);
    const zone = snapshot.zones.find((item) => item.id === target.id);
    if (zone)
      patches.push({
        collection: 'zones',
        id: zone.id,
        before: zone,
        after: null,
      });
    const bounds = draft.zoneBounds[target.id];
    if (bounds)
      patches.push({
        collection: 'zoneBounds',
        id: target.id,
        before: bounds,
        after: null,
      });
  } else if (target.kind === 'row') {
    snapshot.seats
      .filter(
        (seat) =>
          seat.placement.kind === 'row' && seat.placement.rowId === target.id,
      )
      .forEach(removeSeat);
    const row = snapshot.rows.find((item) => item.id === target.id);
    if (row) removeRow(row);
  } else if (target.kind === 'table') {
    snapshot.seats
      .filter(
        (seat) =>
          seat.placement.kind === 'table' &&
          seat.placement.tableId === target.id,
      )
      .forEach(removeSeat);
    const table = snapshot.tables.find((item) => item.id === target.id);
    if (table) removeTable(table);
  } else {
    const seat = snapshot.seats.find((item) => item.id === target.id);
    if (seat) removeSeat(seat);
  }
  return { kind: 'delete', patches };
}

function uniquePatches(commands: readonly EditorCommand[]): EditorPatch[] {
  const patches = new Map<string, EditorPatch>();
  for (const command of commands) {
    for (const patch of command.patches) {
      const key =
        patch.collection === 'calibration'
          ? 'calibration'
          : `${patch.collection}:${patch.id}`;
      if (!patches.has(key)) patches.set(key, patch);
    }
  }
  return [...patches.values()];
}

export function moveTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  delta: Vector2,
): EditorCommand {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    throw new RangeError('Move delta must be finite');
  if (delta.x === 0 && delta.y === 0) return { kind: 'move', patches: [] };
  return {
    kind: 'move',
    patches: uniquePatches(
      targets.map((target) => moveTarget(draft, target, delta)),
    ),
  };
}

export function deleteTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
): EditorCommand {
  return {
    kind: 'delete',
    patches: uniquePatches(
      targets.map((target) => deleteTarget(draft, target)),
    ),
  };
}

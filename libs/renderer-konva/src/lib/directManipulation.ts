import {
  worldPointSchema,
  type LayoutSnapshot,
  type Row,
  type Table,
} from '@hall-platform/domain';
import {
  generateRowSeatSlots,
  generateTableSeatSlots,
  type SpatialBounds,
  type Vector2,
} from '@hall-platform/geometry';
import type { HallScene, HallTarget } from './hallScene.js';

export type EditHandle = Readonly<{
  id: string;
  point: Vector2;
  target: HallTarget;
}>;

export function snapPoint(point: Vector2, enabled: boolean): Vector2 {
  return enabled ? { x: Math.round(point.x), y: Math.round(point.y) } : point;
}

export function gridStepForScale(scale: number): number {
  return scale >= 4 ? 1 : Math.max(10, 10 ** Math.ceil(Math.log10(8 / scale)));
}

export function snappedMoveDelta(
  start: Vector2,
  delta: Vector2,
  enabled: boolean,
): Vector2 {
  if (!enabled) return delta;
  const end = snapPoint({ x: start.x + delta.x, y: start.y + delta.y }, true);
  return {
    x: end.x - snapPoint(start, true).x,
    y: end.y - snapPoint(start, true).y,
  };
}

export function boxSelectedTargets(
  scene: HallScene,
  bounds: SpatialBounds,
): HallTarget[] {
  return scene.index
    .search(bounds)
    .flatMap(({ value, bounds: item }) =>
      item.minX >= bounds.minX &&
      item.maxX <= bounds.maxX &&
      item.minY >= bounds.minY &&
      item.maxY <= bounds.maxY
        ? [value]
        : [],
    );
}

export function shouldStartBoxSelection(
  target: HallTarget | null,
  selected: boolean,
  shift: boolean,
): boolean {
  return !target || (target.kind === 'zone' && (!selected || shift));
}

type PreviewSlot = Readonly<{
  key: string;
  position: Vector2;
  rotationRadians: number;
}>;

function previewSeatsForSlots(
  snapshot: LayoutSnapshot,
  placement: 'row' | 'table',
  parentId: string,
  oldSlots: readonly PreviewSlot[],
  newSlots: readonly PreviewSlot[],
): LayoutSnapshot['seats'] {
  const before = new Map(oldSlots.map((slot) => [slot.key, slot]));
  const after = new Map(newSlots.map((slot) => [slot.key, slot]));
  let attachedIndex = 0;
  return snapshot.seats.map((seat) => {
    if (seat.placement.kind !== placement) return seat;
    const seatParentId =
      seat.placement.kind === 'row'
        ? seat.placement.rowId
        : seat.placement.tableId;
    if (seatParentId !== parentId) return seat;
    const key = seat.slotKey ?? oldSlots[attachedIndex]?.key ?? '';
    attachedIndex += 1;
    const oldSlot = before.get(key);
    const newSlot = after.get(key);
    if (!oldSlot || !newSlot) return seat;
    return {
      ...seat,
      position: worldPointSchema.parse({
        x: newSlot.position.x + seat.position.x - oldSlot.position.x,
        y: newSlot.position.y + seat.position.y - oldSlot.position.y,
      }),
      rotationRadians:
        (seat.rotationRadians ?? oldSlot.rotationRadians) +
        newSlot.rotationRadians -
        oldSlot.rotationRadians,
    };
  });
}

function previewRowSeats(
  snapshot: LayoutSnapshot,
  before: Row,
  after: Row,
): LayoutSnapshot['seats'] {
  const count = snapshot.seats.filter(
    (seat) =>
      seat.placement.kind === 'row' && seat.placement.rowId === before.id,
  ).length;
  if (count === 0) return snapshot.seats;
  const options = before.generation ?? {
    distribution: { kind: 'even' as const, count },
  };
  try {
    const oldSlots = generateRowSeatSlots(before.curve, options).map(
      (slot) => ({
        key: String(slot.slotIndex),
        position: slot.position,
        rotationRadians: slot.rotationRadians,
      }),
    );
    const newSlots = generateRowSeatSlots(after.curve, options).map((slot) => ({
      key: String(slot.slotIndex),
      position: slot.position,
      rotationRadians: slot.rotationRadians,
    }));
    return previewSeatsForSlots(snapshot, 'row', before.id, oldSlots, newSlots);
  } catch {
    return snapshot.seats;
  }
}

function previewTableSeats(
  snapshot: LayoutSnapshot,
  before: Table,
  after: Table,
): LayoutSnapshot['seats'] {
  const options = before.generation ?? { seatOffset: 0.6 };
  try {
    const oldSlots = generateTableSeatSlots(before, options).map((slot) => ({
      key: slot.slotKey,
      position: slot.position,
      rotationRadians: slot.facingRadians - Math.PI / 2,
    }));
    const newSlots = generateTableSeatSlots(after, options).map((slot) => ({
      key: slot.slotKey,
      position: slot.position,
      rotationRadians: slot.facingRadians - Math.PI / 2,
    }));
    return previewSeatsForSlots(
      snapshot,
      'table',
      before.id,
      oldSlots,
      newSlots,
    );
  } catch {
    return snapshot.seats;
  }
}

function rotatedPoint(
  center: Vector2,
  x: number,
  y: number,
  angle: number,
): Vector2 {
  return {
    x: center.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: center.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

export function handlesForTarget(
  scene: HallScene,
  target: HallTarget,
): EditHandle[] {
  const handle = (id: string, point: Vector2): EditHandle => ({
    id,
    point,
    target,
  });
  if (target.kind === 'seat') {
    const seat = scene.seats.find((item) => item.id === target.id);
    return seat
      ? [
          handle(
            'rotate',
            rotatedPoint(seat.position, 1.7, 0, seat.rotationRadians ?? 0),
          ),
        ]
      : [];
  }
  if (target.kind === 'row') {
    const curve = scene.rows.find(({ row }) => row.id === target.id)?.row.curve;
    if (!curve) return [];
    switch (curve.kind) {
      case 'line':
        return [handle('start', curve.start), handle('end', curve.end)];
      case 'bezier':
        return [
          handle('start', curve.p0),
          handle('control1', curve.p1),
          handle('control2', curve.p2),
          handle('end', curve.p3),
        ];
      case 'polyline':
        return curve.points.map((point, index) =>
          handle(`point:${index}`, point),
        );
      case 'arc':
        return [
          handle('center', curve.center),
          handle(
            'radius',
            rotatedPoint(
              curve.center,
              curve.radius,
              0,
              (curve.startAngle + curve.endAngle) / 2,
            ),
          ),
          handle(
            'startAngle',
            rotatedPoint(curve.center, curve.radius, 0, curve.startAngle),
          ),
          handle(
            'endAngle',
            rotatedPoint(curve.center, curve.radius, 0, curve.endAngle),
          ),
        ];
    }
  }
  if (target.kind === 'table') {
    const table = scene.tables.find((item) => item.id === target.id);
    if (!table) return [];
    const extent =
      table.shape.kind === 'circle'
        ? table.shape.radius
        : table.shape.width / 2;
    const size =
      table.shape.kind === 'circle'
        ? rotatedPoint(table.center, extent, 0, table.rotationRadians)
        : rotatedPoint(
            table.center,
            table.shape.width / 2,
            table.shape.height / 2,
            table.rotationRadians,
          );
    return [
      handle('size', size),
      handle(
        'rotate',
        rotatedPoint(table.center, extent + 2, 0, table.rotationRadians),
      ),
    ];
  }
  if (target.kind === 'zone') {
    const zone = scene.zones.find((item) => item.zone.id === target.id);
    if (!zone) return [];
    const { minX, minY, maxX, maxY } = zone.bounds;
    return [
      handle('bounds:nw', { x: minX, y: minY }),
      handle('bounds:ne', { x: maxX, y: minY }),
      handle('bounds:se', { x: maxX, y: maxY }),
      handle('bounds:sw', { x: minX, y: maxY }),
    ];
  }
  return [];
}

export function hitHandle(
  handles: readonly EditHandle[],
  point: Vector2,
  tolerance: number,
): EditHandle | null {
  return (
    handles.find(
      (handle) =>
        Math.hypot(point.x - handle.point.x, point.y - handle.point.y) <=
        tolerance,
    ) ?? null
  );
}

export function editHandleGeometry(
  snapshot: LayoutSnapshot,
  zoneBounds: Readonly<Record<string, SpatialBounds>>,
  target: HallTarget,
  handleId: string,
  point: Vector2,
): {
  snapshot: LayoutSnapshot;
  zoneBounds: Readonly<Record<string, SpatialBounds>>;
} {
  const worldPoint = worldPointSchema.parse(point);
  if (target.kind === 'seat' && handleId === 'rotate') {
    return {
      snapshot: {
        ...snapshot,
        seats: snapshot.seats.map((seat) =>
          seat.id === target.id
            ? {
                ...seat,
                rotationRadians: Math.atan2(
                  point.y - seat.position.y,
                  point.x - seat.position.x,
                ),
              }
            : seat,
        ),
      },
      zoneBounds,
    };
  }
  if (target.kind === 'row') {
    const rows = snapshot.rows.map((row) => {
      if (row.id !== target.id) return row;
      const curve = row.curve;
      switch (curve.kind) {
        case 'line':
          return {
            ...row,
            curve:
              handleId === 'start'
                ? { ...curve, start: worldPoint }
                : handleId === 'end'
                  ? { ...curve, end: worldPoint }
                  : curve,
          };
        case 'bezier': {
          const field = {
            start: 'p0',
            control1: 'p1',
            control2: 'p2',
            end: 'p3',
          }[handleId] as 'p0' | 'p1' | 'p2' | 'p3' | undefined;
          return field
            ? { ...row, curve: { ...curve, [field]: worldPoint } }
            : row;
        }
        case 'polyline': {
          const index = /^point:(\d+)$/.exec(handleId)?.[1];
          return index === undefined
            ? row
            : {
                ...row,
                curve: {
                  ...curve,
                  points: curve.points.map((original, position) =>
                    position === Number(index) ? worldPoint : original,
                  ),
                },
              };
        }
        case 'arc': {
          if (handleId === 'center')
            return { ...row, curve: { ...curve, center: worldPoint } };
          const dx = point.x - curve.center.x;
          const dy = point.y - curve.center.y;
          if (handleId === 'radius')
            return {
              ...row,
              curve: { ...curve, radius: Math.max(0.1, Math.hypot(dx, dy)) },
            };
          if (handleId === 'startAngle')
            return {
              ...row,
              curve: { ...curve, startAngle: Math.atan2(dy, dx) },
            };
          if (handleId === 'endAngle')
            return {
              ...row,
              curve: { ...curve, endAngle: Math.atan2(dy, dx) },
            };
          return row;
        }
      }
      return row;
    });
    const before = snapshot.rows.find((row) => row.id === target.id);
    const after = rows.find((row) => row.id === target.id);
    return {
      snapshot: {
        ...snapshot,
        rows,
        seats:
          before && after
            ? previewRowSeats(snapshot, before, after)
            : snapshot.seats,
      },
      zoneBounds,
    };
  }
  if (target.kind === 'table') {
    const tables = snapshot.tables.map((table) => {
      if (table.id !== target.id) return table;
      const dx = point.x - table.center.x;
      const dy = point.y - table.center.y;
      if (handleId === 'rotate')
        return { ...table, rotationRadians: Math.atan2(dy, dx) };
      if (handleId !== 'size') return table;
      if (table.shape.kind === 'circle')
        return {
          ...table,
          shape: { ...table.shape, radius: Math.max(0.1, Math.hypot(dx, dy)) },
        };
      const x =
        dx * Math.cos(table.rotationRadians) +
        dy * Math.sin(table.rotationRadians);
      const y =
        -dx * Math.sin(table.rotationRadians) +
        dy * Math.cos(table.rotationRadians);
      return {
        ...table,
        shape: {
          ...table.shape,
          width: Math.max(0.1, 2 * Math.abs(x)),
          height: Math.max(0.1, 2 * Math.abs(y)),
        },
      };
    });
    const before = snapshot.tables.find((table) => table.id === target.id);
    const after = tables.find((table) => table.id === target.id);
    return {
      snapshot: {
        ...snapshot,
        tables,
        seats:
          before && after
            ? previewTableSeats(snapshot, before, after)
            : snapshot.seats,
      },
      zoneBounds,
    };
  }
  if (target.kind === 'zone') {
    const bounds = zoneBounds[target.id];
    if (!bounds || !/^bounds:(nw|ne|se|sw)$/.test(handleId))
      return { snapshot, zoneBounds };
    const corner = handleId.slice('bounds:'.length);
    const minX = corner.includes('w')
      ? Math.min(point.x, bounds.maxX - 0.1)
      : bounds.minX;
    const maxX = corner.includes('e')
      ? Math.max(point.x, bounds.minX + 0.1)
      : bounds.maxX;
    const minY = corner.includes('n')
      ? Math.min(point.y, bounds.maxY - 0.1)
      : bounds.minY;
    const maxY = corner.includes('s')
      ? Math.max(point.y, bounds.minY + 0.1)
      : bounds.maxY;
    const resized = { minX, minY, maxX, maxY };
    const originalWidth = bounds.maxX - bounds.minX;
    const originalHeight = bounds.maxY - bounds.minY;
    const zones = snapshot.zones.map((zone) => {
      if (zone.id !== target.id || !zone.polygon) return zone;
      return {
        ...zone,
        polygon: zone.polygon.map((vertex) => worldPointSchema.parse({
          x: minX + (originalWidth ? (vertex.x - bounds.minX) / originalWidth : 0) * (maxX - minX),
          y: minY + (originalHeight ? (vertex.y - bounds.minY) / originalHeight : 0) * (maxY - minY),
        })),
      };
    });
    return {
      snapshot: { ...snapshot, zones },
      zoneBounds: { ...zoneBounds, [target.id]: resized },
    };
  }
  return { snapshot, zoneBounds };
}

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

export type PolygonEditMode = 'move' | 'resize' | 'geometry';

const cornerHandleIds = ['nw', 'ne', 'se', 'sw'] as const;
const resizeHandleIds = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

function boundsOfPoints(points: readonly Vector2[]): SpatialBounds | null {
  if (points.length === 0) return null;
  return points.slice(1).reduce<SpatialBounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: points[0]?.x ?? 0,
      minY: points[0]?.y ?? 0,
      maxX: points[0]?.x ?? 0,
      maxY: points[0]?.y ?? 0,
    },
  );
}

function boundsHandles(
  target: HallTarget,
  bounds: SpatialBounds,
  mode: PolygonEditMode | undefined,
): EditHandle[] {
  if (mode === 'move' || mode === 'geometry') return [];
  const ids = mode === 'resize' ? resizeHandleIds : cornerHandleIds;
  const middleX = (bounds.minX + bounds.maxX) / 2;
  const middleY = (bounds.minY + bounds.maxY) / 2;
  const points: Record<(typeof resizeHandleIds)[number], Vector2> = {
    nw: { x: bounds.minX, y: bounds.minY },
    n: { x: middleX, y: bounds.minY },
    ne: { x: bounds.maxX, y: bounds.minY },
    e: { x: bounds.maxX, y: middleY },
    se: { x: bounds.maxX, y: bounds.maxY },
    s: { x: middleX, y: bounds.maxY },
    sw: { x: bounds.minX, y: bounds.maxY },
    w: { x: bounds.minX, y: middleY },
  };
  return ids.map((id) => ({ id: `bounds:${id}`, point: points[id], target }));
}

function vertexHandles(
  target: HallTarget,
  polygon: readonly Vector2[],
  mode: PolygonEditMode | undefined,
): EditHandle[] {
  return mode === 'geometry'
    ? polygon.map((point, index) => ({
        id: `vertex:${index}`,
        point,
        target,
      }))
    : [];
}

function resizeBounds(
  before: SpatialBounds,
  handleId: string,
  point: Vector2,
): SpatialBounds {
  const handle = handleId.slice('bounds:'.length);
  const next = { ...before };
  if (handle.endsWith('w')) next.minX = Math.min(point.x, before.maxX - 0.1);
  if (handle.endsWith('e')) next.maxX = Math.max(point.x, before.minX + 0.1);
  if (handle.startsWith('n')) next.minY = Math.min(point.y, before.maxY - 0.1);
  if (handle.startsWith('s')) next.maxY = Math.max(point.y, before.minY + 0.1);
  return next;
}

function transformPolygon(
  polygon: readonly Vector2[],
  before: SpatialBounds,
  after: SpatialBounds,
) {
  const oldWidth = before.maxX - before.minX;
  const oldHeight = before.maxY - before.minY;
  const width = after.maxX - after.minX;
  const height = after.maxY - after.minY;
  return polygon.map((vertex) =>
    worldPointSchema.parse({
      x:
        after.minX +
        (oldWidth ? (vertex.x - before.minX) / oldWidth : 0) * width,
      y:
        after.minY +
        (oldHeight ? (vertex.y - before.minY) / oldHeight : 0) * height,
    }),
  );
}

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
  return scene.index.index
    .search(bounds)
    .flatMap(({ value: item, bounds: itemBounds }) =>
      itemBounds.minX >= bounds.minX &&
      itemBounds.maxX <= bounds.maxX &&
      itemBounds.minY >= bounds.minY &&
      itemBounds.maxY <= bounds.maxY
        ? [item.geometry]
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
  polygonMode?: PolygonEditMode,
): EditHandle[] {
  const handle = (id: string, point: Vector2): EditHandle => ({
    id,
    point,
    target,
  });
  if (target.kind === 'seat') return [];
  if (target.kind === 'row') {
    const curve = scene.rowsById.get(target.id)?.row.curve;
    if (!curve) return [];
    const curveHandles = (() => {
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
    })();
    if (polygonMode === 'move') return [];
    if (polygonMode === 'resize') {
      if (curve.kind === 'arc')
        return curveHandles.filter((item) => item.id === 'radius');
      if (curve.kind === 'bezier')
        return curveHandles.filter(
          (item) => item.id === 'start' || item.id === 'end',
        );
      if (curve.kind === 'polyline')
        return curveHandles.filter(
          (item) =>
            item.id === 'point:0' ||
            item.id === `point:${curve.points.length - 1}`,
        );
    }
    if (polygonMode === 'geometry' && curve.kind === 'line')
      return [
        ...curveHandles,
        handle('bend', {
          x: (curve.start.x + curve.end.x) / 2,
          y: (curve.start.y + curve.end.y) / 2,
        }),
      ];
    return curveHandles;
  }
  if (target.kind === 'table') {
    const table = scene.tablesById.get(target.id);
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
    const zone = scene.zonesById.get(target.id);
    if (!zone) return [];
    if (polygonMode === 'geometry' && zone.zone.polygon)
      return vertexHandles(target, zone.zone.polygon, polygonMode);
    return boundsHandles(target, zone.bounds, polygonMode);
  }
  if (target.kind === 'decoration') {
    const decoration = scene.decorationsById.get(target.id);
    if (!decoration || decoration.kind === 'label') return [];
    if (polygonMode === 'geometry')
      return vertexHandles(target, decoration.polygon, polygonMode);
    const bounds = boundsOfPoints(decoration.polygon);
    return bounds ? boundsHandles(target, bounds, polygonMode) : [];
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
  if (target.kind === 'row') {
    const rows = snapshot.rows.map((row) => {
      if (row.id !== target.id) return row;
      const curve = row.curve;
      switch (curve.kind) {
        case 'line':
          if (handleId === 'bend')
            return {
              ...row,
              curve: {
                kind: 'polyline' as const,
                points: [curve.start, worldPoint, curve.end],
              },
            };
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
    const zone = snapshot.zones.find((item) => item.id === target.id);
    const vertexIndex = /^vertex:(\d+)$/.exec(handleId)?.[1];
    if (zone?.polygon && vertexIndex !== undefined) {
      return {
        snapshot: {
          ...snapshot,
          zones: snapshot.zones.map((item) =>
            item.id !== target.id
              ? item
              : {
                  ...item,
                  polygon: item.polygon?.map((vertex, index) =>
                    index === Number(vertexIndex) ? worldPoint : vertex,
                  ),
                },
          ),
        },
        zoneBounds,
      };
    }
    const bounds = zoneBounds[target.id];
    if (!bounds || !/^bounds:(nw|n|ne|e|se|s|sw|w)$/.test(handleId))
      return { snapshot, zoneBounds };
    const resized = resizeBounds(bounds, handleId, point);
    const zones = snapshot.zones.map((item) => {
      if (item.id !== target.id || !item.polygon) return item;
      return {
        ...item,
        polygon: transformPolygon(item.polygon, bounds, resized),
      };
    });
    return {
      snapshot: { ...snapshot, zones },
      zoneBounds: { ...zoneBounds, [target.id]: resized },
    };
  }
  if (target.kind === 'decoration') {
    const decoration = snapshot.decorations.find(
      (item) => item.id === target.id,
    );
    if (!decoration || decoration.kind === 'label')
      return { snapshot, zoneBounds };
    const vertexIndex = /^vertex:(\d+)$/.exec(handleId)?.[1];
    const bounds = boundsOfPoints(decoration.polygon);
    if (!bounds) return { snapshot, zoneBounds };
    let polygon: ReturnType<typeof worldPointSchema.parse>[] | null = null;
    if (vertexIndex !== undefined) {
      polygon = decoration.polygon.map((vertex, index) =>
        index === Number(vertexIndex) ? worldPoint : vertex,
      );
    } else if (/^bounds:(nw|n|ne|e|se|s|sw|w)$/.test(handleId)) {
      polygon = transformPolygon(
        decoration.polygon,
        bounds,
        resizeBounds(bounds, handleId, point),
      );
    }
    if (!polygon) return { snapshot, zoneBounds };
    return {
      snapshot: {
        ...snapshot,
        decorations: snapshot.decorations.map((item) =>
          item.id === target.id && item.kind !== 'label'
            ? { ...item, polygon }
            : item,
        ),
      },
      zoneBounds,
    };
  }
  return { snapshot, zoneBounds };
}

import { worldPointSchema, type Row, type Seat } from '@hall-platform/domain';
import type { Vector2, SpatialBounds } from '@hall-platform/geometry';
import {
  buildHallScene,
  targetBounds,
  type HallTarget,
} from '@hall-platform/renderer-konva';
import type { EditorCommand } from '../editorCommands.js';
import type { HallLayoutDraft } from '../editorDraft.js';
import { transformRow, transformTable } from './transformSelection.js';

const empty: EditorCommand = { kind: 'update', patches: [] };
const minimumSize = 0.1;

function resizeBounds(
  before: SpatialBounds,
  handleId: string,
  point: Vector2,
): SpatialBounds {
  const next = { ...before };
  const corner = handleId.slice('bounds:'.length);
  if (corner.endsWith('w'))
    next.minX = Math.min(point.x, before.maxX - minimumSize);
  if (corner.endsWith('e'))
    next.maxX = Math.max(point.x, before.minX + minimumSize);
  if (corner.startsWith('n'))
    next.minY = Math.min(point.y, before.maxY - minimumSize);
  if (corner.startsWith('s'))
    next.maxY = Math.max(point.y, before.minY + minimumSize);
  return next;
}

function updateRowCurve(
  row: Row,
  handleId: string,
  point: Vector2,
): Row | null {
  const curve = row.curve;
  const world = worldPointSchema.parse(point);
  if (curve.kind === 'line') {
    if (handleId === 'start')
      return { ...row, curve: { ...curve, start: world } };
    if (handleId === 'end') return { ...row, curve: { ...curve, end: world } };
  }
  if (curve.kind === 'bezier') {
    const key = { start: 'p0', control1: 'p1', control2: 'p2', end: 'p3' }[
      handleId
    ] as keyof typeof curve | undefined;
    if (key) return { ...row, curve: { ...curve, [key]: world } };
  }
  if (curve.kind === 'polyline' && handleId.startsWith('point:')) {
    const index = Number(handleId.slice(6));
    if (
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < curve.points.length
    )
      return {
        ...row,
        curve: {
          ...curve,
          points: curve.points.map((value, i) => (i === index ? world : value)),
        },
      };
  }
  if (curve.kind === 'arc') {
    if (handleId === 'center')
      return { ...row, curve: { ...curve, center: world } };
    if (handleId === 'radius')
      return {
        ...row,
        curve: {
          ...curve,
          radius: Math.max(
            minimumSize,
            Math.hypot(point.x - curve.center.x, point.y - curve.center.y),
          ),
        },
      };
    if (handleId === 'startAngle' || handleId === 'endAngle')
      return {
        ...row,
        curve: {
          ...curve,
          [handleId]: Math.atan2(
            point.y - curve.center.y,
            point.x - curve.center.x,
          ),
        },
      };
  }
  return null;
}

export function editHandle(
  draft: HallLayoutDraft,
  target: HallTarget,
  handleId: string,
  point: Vector2,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RangeError('Handle point must be finite');
  if (target.kind === 'row') {
    const before = draft.snapshot.rows.find((row) => row.id === target.id);
    const after = before && updateRowCurve(before, handleId, point);
    return before && after
      ? transformRow(draft, before, after, publishedSeatIds)
      : empty;
  }
  if (target.kind === 'table') {
    const before = draft.snapshot.tables.find(
      (table) => table.id === target.id,
    );
    if (!before) return empty;
    const dx = point.x - before.center.x;
    const dy = point.y - before.center.y;
    if (handleId === 'rotate')
      return transformTable(
        draft,
        before,
        { ...before, rotationRadians: Math.atan2(dy, dx) },
        publishedSeatIds,
      );
    if (handleId !== 'size') return empty;
    const shape =
      before.shape.kind === 'circle'
        ? { ...before.shape, radius: Math.max(minimumSize, Math.hypot(dx, dy)) }
        : (() => {
            const cosine = Math.cos(before.rotationRadians);
            const sine = Math.sin(before.rotationRadians);
            return {
              ...before.shape,
              width: Math.max(
                minimumSize,
                2 * Math.abs(dx * cosine + dy * sine),
              ),
              height: Math.max(
                minimumSize,
                2 * Math.abs(-dx * sine + dy * cosine),
              ),
            };
          })();
    return transformTable(
      draft,
      before,
      { ...before, shape },
      publishedSeatIds,
    );
  }
  if (target.kind === 'zone' && handleId.startsWith('bounds:')) {
    const zone = draft.snapshot.zones.find((item) => item.id === target.id);
    if (!zone) return empty;
    const polygon = zone.polygon;
    const polygonBounds = polygon
      ? {
          minX: Math.min(...polygon.map((item) => item.x)),
          maxX: Math.max(...polygon.map((item) => item.x)),
          minY: Math.min(...polygon.map((item) => item.y)),
          maxY: Math.max(...polygon.map((item) => item.y)),
        }
      : null;
    const before =
      polygonBounds ??
      draft.zoneBounds[target.id] ??
      targetBounds(
        buildHallScene(draft.snapshot, zone.floorId, draft.zoneBounds),
        target,
      );
    if (!before) return empty;
    const after = resizeBounds(before, handleId, point);
    if (polygon) {
      const oldWidth = before.maxX - before.minX;
      const oldHeight = before.maxY - before.minY;
      const width = after.maxX - after.minX;
      const height = after.maxY - after.minY;
      const transformed = polygon.map((vertex) =>
        worldPointSchema.parse({
          x:
            after.minX +
            (oldWidth ? (vertex.x - before.minX) / oldWidth : 0) * width,
          y:
            after.minY +
            (oldHeight ? (vertex.y - before.minY) / oldHeight : 0) * height,
        }),
      );
      return {
        kind: 'update',
        patches: [
          {
            collection: 'zones',
            id: zone.id,
            before: zone,
            after: { ...zone, polygon: transformed },
          },
        ],
      };
    }
    return {
      kind: 'update',
      patches: [
        {
          collection: 'zoneBounds',
          id: target.id,
          before: draft.zoneBounds[target.id] ?? null,
          after,
        },
      ],
    };
  }
  if (target.kind === 'seat' && handleId === 'rotate') {
    const before = draft.snapshot.seats.find((seat) => seat.id === target.id);
    if (!before) return empty;
    const rotationRadians = Math.atan2(
      point.y - before.position.y,
      point.x - before.position.x,
    );
    const manual =
      before.placement.kind === 'standalone'
        ? before.manual
        : {
            ...before.manual,
            offset:
              before.manual?.offset ?? worldPointSchema.parse({ x: 0, y: 0 }),
            rotationOffsetRadians:
              (before.manual?.rotationOffsetRadians ?? 0) +
              rotationRadians -
              (before.rotationRadians ?? 0),
          };
    return {
      kind: 'update',
      patches: [
        {
          collection: 'seats',
          id: before.id,
          before,
          after: { ...before, rotationRadians, ...(manual ? { manual } : {}) },
        },
      ],
    };
  }
  return empty;
}

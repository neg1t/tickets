import {
  worldPointSchema,
  type Row,
  type Seat,
  type Table,
  type WorldPoint,
} from '@hall-platform/domain';
import type { Vector2 } from '@hall-platform/geometry';
import type { EditorCommand } from '../editorCommands.js';
import type { HallLayoutDraft } from '../editorDraft.js';
import { regenerateRowSeats, regenerateTableSeats } from './regenerateSeats.js';

function translated(point: WorldPoint, delta: Vector2): WorldPoint {
  return worldPointSchema.parse({ x: point.x + delta.x, y: point.y + delta.y });
}

export function translateRow(row: Row, delta: Vector2): Row {
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

export function transformRow(
  draft: HallLayoutDraft,
  before: Row,
  after: Row,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  return regenerateRowSeats(draft, before, after, { publishedSeatIds });
}

export function transformTable(
  draft: HallLayoutDraft,
  before: Table,
  after: Table,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  return regenerateTableSeats(draft, before, after, { publishedSeatIds });
}

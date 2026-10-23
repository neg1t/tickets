import { closestPointOnSegment } from './line.js';
import {
  crossVectors,
  distanceBetweenVectors,
  dotVectors,
  subtractVectors,
  vectorLengthSquared,
  type Vector2,
} from './vector.js';

// The last vertex connects back to the first. A repeated closing vertex is optional.
export type Polygon = readonly Vector2[];

export type PolygonBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type PolygonWinding = 'clockwise' | 'counterclockwise' | 'degenerate';

export function signedPolygonArea(polygon: Polygon): number {
  if (polygon.length < 3) return 0;

  let doubledArea = 0;
  for (const [index, current] of polygon.entries()) {
    const next = polygon[(index + 1) % polygon.length];
    if (next === undefined) continue;
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea / 2;
}

export function polygonArea(polygon: Polygon): number {
  return Math.abs(signedPolygonArea(polygon));
}

export function polygonWinding(polygon: Polygon): PolygonWinding {
  const area = signedPolygonArea(polygon);
  if (area === 0) return 'degenerate';
  // Positive signed area is clockwise when the Y axis points down.
  return area > 0 ? 'clockwise' : 'counterclockwise';
}

export function polygonBounds(polygon: Polygon): PolygonBounds | null {
  if (polygon.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function isPointOnSegment(start: Vector2, end: Vector2, point: Vector2) {
  const direction = subtractVectors(end, start);
  const lengthSquared = vectorLengthSquared(direction);
  if (lengthSquared === 0) return point.x === start.x && point.y === start.y;

  const offset = subtractVectors(point, start);
  if (crossVectors(direction, offset) !== 0) return false;

  const projection = dotVectors(offset, direction);
  return projection >= 0 && projection <= lengthSquared;
}

// Uses the even-odd rule. Points on the boundary count as inside.
export function isPointInPolygon(polygon: Polygon, point: Vector2): boolean {
  if (polygon.length === 0) return false;

  let inside = false;
  for (const [index, start] of polygon.entries()) {
    const end = polygon[(index + 1) % polygon.length];
    if (end === undefined) continue;
    if (isPointOnSegment(start, end, point)) return true;

    if (start.y > point.y !== end.y > point.y) {
      const intersectionX =
        start.x + ((point.y - start.y) * (end.x - start.x)) / (end.y - start.y);
      if (point.x < intersectionX) inside = !inside;
    }
  }
  return inside;
}

export function closestPointOnPolygonBoundary(
  polygon: Polygon,
  point: Vector2,
): Vector2 | null {
  if (polygon.length === 0) return null;

  let nearest: Vector2 | null = null;
  let minimumDistanceSquared = Infinity;
  for (const [index, start] of polygon.entries()) {
    const end = polygon[(index + 1) % polygon.length];
    if (end === undefined) continue;
    const candidate = closestPointOnSegment({ start, end }, point);
    const distanceSquared = vectorLengthSquared(
      subtractVectors(point, candidate),
    );
    if (distanceSquared < minimumDistanceSquared) {
      nearest = candidate;
      minimumDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

export function distanceToPolygonBoundary(
  polygon: Polygon,
  point: Vector2,
): number | null {
  const closest = closestPointOnPolygonBoundary(polygon, point);
  return closest === null ? null : distanceBetweenVectors(closest, point);
}

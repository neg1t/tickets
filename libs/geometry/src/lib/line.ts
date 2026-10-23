import {
  distanceBetweenVectors,
  dotVectors,
  lerpVectors,
  normalizeVector,
  subtractVectors,
  vectorLengthSquared,
  type Vector2,
} from './vector.js';

export type LineSegment = {
  readonly start: Vector2;
  readonly end: Vector2;
};

export function lineLength(line: LineSegment): number {
  return distanceBetweenVectors(line.start, line.end);
}

// Fractions outside [0, 1] extrapolate beyond the segment.
export function linePointAtFraction(
  line: LineSegment,
  fraction: number,
): Vector2 {
  return lerpVectors(line.start, line.end, fraction);
}

export function lineUnitTangent(line: LineSegment): Vector2 | null {
  return normalizeVector(subtractVectors(line.end, line.start));
}

// The normal points clockwise from the tangent in Y-down coordinates.
export function lineUnitNormal(line: LineSegment): Vector2 | null {
  const tangent = lineUnitTangent(line);
  return tangent === null ? null : { x: -tangent.y, y: tangent.x };
}

export function closestFractionOnSegment(
  line: LineSegment,
  point: Vector2,
): number {
  const direction = subtractVectors(line.end, line.start);
  const lengthSquared = vectorLengthSquared(direction);
  if (lengthSquared === 0) return 0;

  const fromStart = subtractVectors(point, line.start);
  const fraction = dotVectors(fromStart, direction) / lengthSquared;
  return Math.max(0, Math.min(1, fraction));
}

export function closestPointOnSegment(
  line: LineSegment,
  point: Vector2,
): Vector2 {
  return linePointAtFraction(line, closestFractionOnSegment(line, point));
}

export function distanceToSegment(line: LineSegment, point: Vector2): number {
  return distanceBetweenVectors(point, closestPointOnSegment(line, point));
}

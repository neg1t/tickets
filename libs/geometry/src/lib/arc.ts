import { distanceBetweenVectors, type Vector2 } from './vector.js';

export type CircularArc = {
  readonly center: Vector2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
};

const fullTurn = 2 * Math.PI;

function positiveAngle(angle: number): number {
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export function arcLength(arc: CircularArc): number {
  return arc.radius * Math.abs(arc.endAngle - arc.startAngle);
}

// Angles are radians; positive sweep turns clockwise in Y-down coordinates.
export function arcPointAtFraction(
  arc: CircularArc,
  fraction: number,
): Vector2 {
  const angle = arc.startAngle + (arc.endAngle - arc.startAngle) * fraction;
  return {
    x: arc.center.x + arc.radius * Math.cos(angle),
    y: arc.center.y + arc.radius * Math.sin(angle),
  };
}

export function arcUnitTangent(
  arc: CircularArc,
  fraction: number,
): Vector2 | null {
  const sweep = arc.endAngle - arc.startAngle;
  if (sweep === 0) return null;

  const angle = arc.startAngle + sweep * fraction;
  const direction = Math.sign(sweep);
  return {
    x: -Math.sin(angle) * direction,
    y: Math.cos(angle) * direction,
  };
}

export function closestFractionOnArc(arc: CircularArc, point: Vector2): number {
  const sweep = arc.endAngle - arc.startAngle;
  if (sweep === 0) return 0;

  const fromCenterX = point.x - arc.center.x;
  const fromCenterY = point.y - arc.center.y;
  if (fromCenterX === 0 && fromCenterY === 0) return 0;

  const angle = Math.atan2(fromCenterY, fromCenterX);
  const offset = positiveAngle(
    sweep > 0 ? angle - arc.startAngle : arc.startAngle - angle,
  );
  const sweepMagnitude = Math.abs(sweep);
  if (sweepMagnitude >= fullTurn || offset <= sweepMagnitude) {
    return offset / sweepMagnitude;
  }

  const startDistance = distanceBetweenVectors(
    point,
    arcPointAtFraction(arc, 0),
  );
  const endDistance = distanceBetweenVectors(point, arcPointAtFraction(arc, 1));
  return startDistance <= endDistance ? 0 : 1;
}

export function closestPointOnArc(arc: CircularArc, point: Vector2): Vector2 {
  return arcPointAtFraction(arc, closestFractionOnArc(arc, point));
}

export function distanceToArc(arc: CircularArc, point: Vector2): number {
  return distanceBetweenVectors(point, closestPointOnArc(arc, point));
}

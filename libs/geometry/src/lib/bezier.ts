import {
  distanceBetweenVectors,
  lerpVectors,
  normalizeVector,
  subtractVectors,
  type Vector2,
} from './vector.js';

export type CubicBezier = {
  readonly p0: Vector2;
  readonly p1: Vector2;
  readonly p2: Vector2;
  readonly p3: Vector2;
};

export type BezierArcLengthSample = {
  readonly parameter: number;
  readonly length: number;
};

export type BezierArcLengthTable = {
  readonly curve: CubicBezier;
  readonly totalLength: number;
  readonly samples: readonly BezierArcLengthSample[];
};

const defaultSubdivisions = 256;

export function bezierPointAtParameter(
  curve: CubicBezier,
  parameter: number,
): Vector2 {
  const first = lerpVectors(curve.p0, curve.p1, parameter);
  const second = lerpVectors(curve.p1, curve.p2, parameter);
  const third = lerpVectors(curve.p2, curve.p3, parameter);
  return lerpVectors(
    lerpVectors(first, second, parameter),
    lerpVectors(second, third, parameter),
    parameter,
  );
}

export function bezierUnitTangentAtParameter(
  curve: CubicBezier,
  parameter: number,
): Vector2 | null {
  const remainder = 1 - parameter;
  const derivative: Vector2 = {
    x:
      3 * remainder * remainder * (curve.p1.x - curve.p0.x) +
      6 * remainder * parameter * (curve.p2.x - curve.p1.x) +
      3 * parameter * parameter * (curve.p3.x - curve.p2.x),
    y:
      3 * remainder * remainder * (curve.p1.y - curve.p0.y) +
      6 * remainder * parameter * (curve.p2.y - curve.p1.y) +
      3 * parameter * parameter * (curve.p3.y - curve.p2.y),
  };
  const tangent = normalizeVector(derivative);
  if (tangent !== null) return tangent;

  const step = 1e-4;
  const before = parameter <= 0 ? parameter : parameter - step;
  const after = parameter >= 1 ? parameter : parameter + step;
  return normalizeVector(
    subtractVectors(
      bezierPointAtParameter(curve, after),
      bezierPointAtParameter(curve, before),
    ),
  );
}

export function createBezierArcLengthTable(
  curve: CubicBezier,
  subdivisions = defaultSubdivisions,
): BezierArcLengthTable {
  if (!Number.isSafeInteger(subdivisions) || subdivisions < 1) {
    throw new RangeError('Bezier subdivisions must be a positive integer');
  }

  const curveSnapshot: CubicBezier = {
    p0: { ...curve.p0 },
    p1: { ...curve.p1 },
    p2: { ...curve.p2 },
    p3: { ...curve.p3 },
  };
  const samples: BezierArcLengthSample[] = [{ parameter: 0, length: 0 }];
  let previous = curveSnapshot.p0;
  let totalLength = 0;
  for (let index = 1; index <= subdivisions; index++) {
    const parameter = index / subdivisions;
    const current = bezierPointAtParameter(curveSnapshot, parameter);
    totalLength += distanceBetweenVectors(previous, current);
    samples.push({ parameter, length: totalLength });
    previous = current;
  }

  return { curve: curveSnapshot, totalLength, samples };
}

export function bezierParameterAtLengthFraction(
  table: BezierArcLengthTable,
  fraction: number,
): number {
  if (table.totalLength === 0 || fraction <= 0) return 0;
  if (fraction >= 1) return 1;

  const targetLength = table.totalLength * fraction;
  let lower = 1;
  let upper = table.samples.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const sample = table.samples[middle];
    if (sample && sample.length < targetLength) lower = middle + 1;
    else upper = middle;
  }

  const previous = table.samples[lower - 1];
  const current = table.samples[lower];
  if (!previous || !current) throw new Error('Invalid Bezier length table');
  const segmentLength = current.length - previous.length;
  if (segmentLength === 0) return current.parameter;
  const segmentFraction = (targetLength - previous.length) / segmentLength;
  return (
    previous.parameter +
    (current.parameter - previous.parameter) * segmentFraction
  );
}

export function bezierPointAtLengthFraction(
  table: BezierArcLengthTable,
  fraction: number,
): Vector2 {
  return bezierPointAtParameter(
    table.curve,
    bezierParameterAtLengthFraction(table, fraction),
  );
}

export function bezierUnitTangentAtLengthFraction(
  table: BezierArcLengthTable,
  fraction: number,
): Vector2 | null {
  return bezierUnitTangentAtParameter(
    table.curve,
    bezierParameterAtLengthFraction(table, fraction),
  );
}

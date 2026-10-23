import { describe, expect, it } from 'vitest';
import {
  bezierParameterAtLengthFraction,
  bezierPointAtLengthFraction,
  bezierPointAtParameter,
  bezierUnitTangentAtLengthFraction,
  bezierUnitTangentAtParameter,
  createBezierArcLengthTable,
  type CubicBezier,
} from './bezier.js';

const unevenLine: CubicBezier = {
  p0: { x: 0, y: 0 },
  p1: { x: 0, y: 0 },
  p2: { x: 0, y: 0 },
  p3: { x: 10, y: 0 },
};

describe('cubic Bezier curves', () => {
  it('evaluates endpoints and a parameter that is not a distance fraction', () => {
    expect(bezierPointAtParameter(unevenLine, 0)).toEqual(unevenLine.p0);
    expect(bezierPointAtParameter(unevenLine, 1)).toEqual(unevenLine.p3);
    expect(bezierPointAtParameter(unevenLine, 0.5)).toEqual({ x: 1.25, y: 0 });
    expect(unevenLine.p3).toEqual({ x: 10, y: 0 });
  });

  it('places points by traveled distance rather than uniform parameter', () => {
    const table = createBezierArcLengthTable(unevenLine);

    expect(table.totalLength).toBeCloseTo(10);
    expect(bezierParameterAtLengthFraction(table, 0.5)).toBeGreaterThan(0.75);
    expect(bezierPointAtLengthFraction(table, 0.25).x).toBeCloseTo(2.5, 2);
    expect(bezierPointAtLengthFraction(table, 0.5).x).toBeCloseTo(5, 2);
    expect(bezierPointAtLengthFraction(table, 0.75).x).toBeCloseTo(7.5, 2);
    expect(bezierPointAtLengthFraction(table, -1)).toEqual(unevenLine.p0);
    expect(bezierPointAtLengthFraction(table, 2)).toEqual(unevenLine.p3);
  });

  it('returns a useful endpoint tangent when the derivative is zero', () => {
    expect(bezierUnitTangentAtParameter(unevenLine, 0)).toEqual({ x: 1, y: 0 });
    const table = createBezierArcLengthTable(unevenLine);
    expect(bezierUnitTangentAtLengthFraction(table, 0.5)).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('approximates a curved path more accurately with more samples', () => {
    const curve: CubicBezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 0, y: 10 },
      p2: { x: 10, y: 10 },
      p3: { x: 10, y: 0 },
    };

    const regular = createBezierArcLengthTable(curve);
    const reference = createBezierArcLengthTable(curve, 4096);
    expect(regular.totalLength).toBeGreaterThan(10);
    expect(regular.totalLength).toBeLessThan(30);
    expect(regular.totalLength).toBeCloseTo(reference.totalLength, 2);

    const midpoint = bezierPointAtLengthFraction(regular, 0.5);
    expect(midpoint.x).toBeCloseTo(5, 2);
    expect(midpoint.y).toBeCloseTo(7.5, 2);
  });

  it('handles a point curve and rejects an invalid sample count', () => {
    const point = { x: 3, y: -2 };
    const curve: CubicBezier = { p0: point, p1: point, p2: point, p3: point };
    const table = createBezierArcLengthTable(curve);

    expect(table.totalLength).toBe(0);
    expect(bezierPointAtLengthFraction(table, 0.5)).toEqual(point);
    expect(bezierUnitTangentAtParameter(curve, 0.5)).toBeNull();
    expect(() => createBezierArcLengthTable(curve, 0)).toThrow(RangeError);
    expect(() => createBezierArcLengthTable(curve, 2.5)).toThrow(RangeError);
  });
});

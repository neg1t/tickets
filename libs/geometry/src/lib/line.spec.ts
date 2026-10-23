import { describe, expect, it } from 'vitest';
import {
  closestFractionOnSegment,
  closestPointOnSegment,
  distanceToSegment,
  lineLength,
  linePointAtFraction,
  lineUnitNormal,
  lineUnitTangent,
  type LineSegment,
} from './line.js';

describe('line segments', () => {
  it('measures and samples a segment without changing its endpoints', () => {
    const line: LineSegment = {
      start: { x: 0, y: 0 },
      end: { x: 3, y: 4 },
    };

    expect(lineLength(line)).toBe(5);
    expect(linePointAtFraction(line, 0)).toEqual(line.start);
    expect(linePointAtFraction(line, 0.5)).toEqual({ x: 1.5, y: 2 });
    expect(linePointAtFraction(line, 1)).toEqual(line.end);
    expect(linePointAtFraction(line, 1.5)).toEqual({ x: 4.5, y: 6 });
    expect(line).toEqual({ start: { x: 0, y: 0 }, end: { x: 3, y: 4 } });
  });

  it('returns unit tangent and clockwise normal in Y-down coordinates', () => {
    const line: LineSegment = {
      start: { x: 0, y: 0 },
      end: { x: 3, y: 4 },
    };

    expect(lineUnitTangent(line)?.x).toBeCloseTo(0.6);
    expect(lineUnitTangent(line)?.y).toBeCloseTo(0.8);
    expect(lineUnitNormal(line)?.x).toBeCloseTo(-0.8);
    expect(lineUnitNormal(line)?.y).toBeCloseTo(0.6);
  });

  it('projects to the nearest point within the segment', () => {
    const line: LineSegment = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
    };

    expect(closestFractionOnSegment(line, { x: 4, y: 3 })).toBe(0.4);
    expect(closestPointOnSegment(line, { x: 4, y: 3 })).toEqual({ x: 4, y: 0 });
    expect(distanceToSegment(line, { x: 4, y: 3 })).toBe(3);

    expect(closestFractionOnSegment(line, { x: -2, y: 3 })).toBe(0);
    expect(closestPointOnSegment(line, { x: -2, y: 3 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(distanceToSegment(line, { x: -2, y: 3 })).toBeCloseTo(Math.sqrt(13));

    expect(closestFractionOnSegment(line, { x: 12, y: -3 })).toBe(1);
    expect(closestPointOnSegment(line, { x: 12, y: -3 })).toEqual({
      x: 10,
      y: 0,
    });
  });

  it('projects onto a diagonal segment using both coordinates', () => {
    const line: LineSegment = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
    };

    expect(closestFractionOnSegment(line, { x: 10, y: 0 })).toBe(0.5);
    expect(closestPointOnSegment(line, { x: 10, y: 0 })).toEqual({
      x: 5,
      y: 5,
    });
    expect(distanceToSegment(line, { x: 10, y: 0 })).toBeCloseTo(Math.sqrt(50));
  });

  it('handles a zero-length segment without invalid numbers', () => {
    const line: LineSegment = {
      start: { x: 3, y: -2 },
      end: { x: 3, y: -2 },
    };

    expect(lineLength(line)).toBe(0);
    expect(linePointAtFraction(line, 0.5)).toEqual({ x: 3, y: -2 });
    expect(lineUnitTangent(line)).toBeNull();
    expect(lineUnitNormal(line)).toBeNull();
    expect(closestFractionOnSegment(line, { x: 6, y: 2 })).toBe(0);
    expect(closestPointOnSegment(line, { x: 6, y: 2 })).toEqual({
      x: 3,
      y: -2,
    });
    expect(distanceToSegment(line, { x: 6, y: 2 })).toBe(5);
  });
});

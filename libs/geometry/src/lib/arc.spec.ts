import { describe, expect, it } from 'vitest';
import {
  arcLength,
  arcPointAtFraction,
  arcUnitTangent,
  closestFractionOnArc,
  closestPointOnArc,
  distanceToArc,
  type CircularArc,
} from './arc.js';

const quarterArc: CircularArc = {
  center: { x: 0, y: 0 },
  radius: 10,
  startAngle: 0,
  endAngle: Math.PI / 2,
};

describe('circular arcs', () => {
  it('measures and samples a clockwise quarter circle in world units', () => {
    expect(arcLength(quarterArc)).toBeCloseTo(5 * Math.PI);
    expect(arcPointAtFraction(quarterArc, 0)).toEqual({ x: 10, y: 0 });

    const middle = arcPointAtFraction(quarterArc, 0.5);
    expect(middle.x).toBeCloseTo(Math.sqrt(50));
    expect(middle.y).toBeCloseTo(Math.sqrt(50));

    const end = arcPointAtFraction(quarterArc, 1);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(10);
    expect(quarterArc.startAngle).toBe(0);
  });

  it('orients tangents along positive and negative angle sweeps', () => {
    const clockwise = arcUnitTangent(quarterArc, 0);
    expect(clockwise?.x).toBeCloseTo(0);
    expect(clockwise?.y).toBeCloseTo(1);

    const counterclockwise: CircularArc = {
      ...quarterArc,
      startAngle: Math.PI / 2,
      endAngle: 0,
    };
    expect(arcLength(counterclockwise)).toBeCloseTo(5 * Math.PI);
    const reverseTangent = arcUnitTangent(counterclockwise, 0);
    expect(reverseTangent?.x).toBeCloseTo(1);
    expect(reverseTangent?.y).toBeCloseTo(0);
    expect(
      closestFractionOnArc(counterclockwise, { x: 10, y: 10 }),
    ).toBeCloseTo(0.5);
  });

  it('projects onto the arc and clamps to its endpoints', () => {
    expect(closestFractionOnArc(quarterArc, { x: 20, y: 0 })).toBe(0);
    expect(closestFractionOnArc(quarterArc, { x: 20, y: 20 })).toBeCloseTo(0.5);
    expect(closestFractionOnArc(quarterArc, { x: -10, y: 20 })).toBe(1);

    const nearest = closestPointOnArc(quarterArc, { x: 20, y: 20 });
    expect(nearest.x).toBeCloseTo(Math.sqrt(50));
    expect(nearest.y).toBeCloseTo(Math.sqrt(50));
    expect(distanceToArc(quarterArc, { x: 20, y: 0 })).toBe(10);
  });

  it('projects correctly when a sweep crosses angle zero or covers a circle', () => {
    const wrapped: CircularArc = {
      ...quarterArc,
      startAngle: (3 * Math.PI) / 2,
      endAngle: (5 * Math.PI) / 2,
    };
    expect(closestFractionOnArc(wrapped, { x: 20, y: 0 })).toBeCloseTo(0.5);

    const circle: CircularArc = { ...quarterArc, endAngle: 2 * Math.PI };
    expect(arcLength(circle)).toBeCloseTo(20 * Math.PI);
    expect(closestFractionOnArc(circle, { x: 0, y: -20 })).toBeCloseTo(0.75);
    const nearest = closestPointOnArc(circle, { x: 0, y: -20 });
    expect(nearest.x).toBeCloseTo(0);
    expect(nearest.y).toBeCloseTo(-10);
  });

  it('handles zero sweep and a query at the center', () => {
    const pointArc: CircularArc = { ...quarterArc, endAngle: 0 };
    expect(arcLength(pointArc)).toBe(0);
    expect(arcUnitTangent(pointArc, 0)).toBeNull();
    expect(closestFractionOnArc(pointArc, { x: 20, y: 20 })).toBe(0);
    expect(distanceToArc(pointArc, { x: 20, y: 0 })).toBe(10);
    expect(closestFractionOnArc(quarterArc, { x: 0, y: 0 })).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  circlesIntersect,
  circleIntersectsPolygon,
  createRectanglePolygon,
  polygonsIntersect,
  segmentsIntersect,
  shapesIntersect,
} from './collision.js';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe('segment collisions', () => {
  it('detects crossing, touching, overlapping and point segments', () => {
    expect(
      segmentsIntersect(
        { start: { x: 0, y: 0 }, end: { x: 4, y: 4 } },
        { start: { x: 0, y: 4 }, end: { x: 4, y: 0 } },
      ),
    ).toBe(true);
    expect(
      segmentsIntersect(
        { start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
        { start: { x: 2, y: 0 }, end: { x: 3, y: 2 } },
      ),
    ).toBe(true);
    expect(
      segmentsIntersect(
        { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
        { start: { x: 2, y: 0 }, end: { x: 6, y: 0 } },
      ),
    ).toBe(true);
    expect(
      segmentsIntersect(
        { start: { x: 2, y: 0 }, end: { x: 2, y: 0 } },
        { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
      ),
    ).toBe(true);
  });

  it('rejects separated and collinear nonoverlapping segments', () => {
    expect(
      segmentsIntersect(
        { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
        { start: { x: 0, y: 2 }, end: { x: 1, y: 3 } },
      ),
    ).toBe(false);
    expect(
      segmentsIntersect(
        { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        { start: { x: 2, y: 0 }, end: { x: 3, y: 0 } },
      ),
    ).toBe(false);
  });
});

describe('shape collisions', () => {
  it('treats circles as colliding when they overlap or touch', () => {
    const first = { center: { x: 0, y: 0 }, radius: 2 };
    expect(circlesIntersect(first, { center: { x: 3, y: 0 }, radius: 1 })).toBe(
      true,
    );
    expect(circlesIntersect(first, { center: { x: 0, y: 0 }, radius: 0 })).toBe(
      true,
    );
    expect(
      circlesIntersect(first, { center: { x: 3.1, y: 0 }, radius: 1 }),
    ).toBe(false);
  });

  it('detects polygon containment and boundary contact', () => {
    expect(
      polygonsIntersect(square, [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
      ]),
    ).toBe(true);
    expect(
      polygonsIntersect(square, [
        { x: 4, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 3 },
        { x: 4, y: 3 },
      ]),
    ).toBe(true);
    expect(
      polygonsIntersect(square, [
        { x: 5, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 2 },
        { x: 5, y: 2 },
      ]),
    ).toBe(false);
    expect(polygonsIntersect(square, [])).toBe(false);
  });

  it('does not report a collision inside the notch of a concave polygon', () => {
    const concave = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    const inNotch = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
    ];

    expect(polygonsIntersect(concave, inNotch)).toBe(false);
    expect(
      polygonsIntersect(concave, [
        { x: 0.5, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 0.5, y: 3 },
      ]),
    ).toBe(true);
  });

  it('detects circles inside, outside and tangent to polygon edges', () => {
    expect(
      circleIntersectsPolygon({ center: { x: 2, y: 2 }, radius: 0.5 }, square),
    ).toBe(true);
    expect(
      circleIntersectsPolygon({ center: { x: 6, y: 2 }, radius: 2 }, square),
    ).toBe(true);
    expect(
      circleIntersectsPolygon({ center: { x: 6.1, y: 2 }, radius: 2 }, square),
    ).toBe(false);
    expect(
      circleIntersectsPolygon({ center: { x: 2, y: 2 }, radius: 10 }, square),
    ).toBe(true);
    expect(
      circleIntersectsPolygon({ center: { x: 2, y: 2 }, radius: 1 }, []),
    ).toBe(false);
  });

  it('builds a rotated rectangle and checks collisions through the shape API', () => {
    const rectangle = {
      kind: 'rectangle' as const,
      center: { x: 10, y: 10 },
      width: 4,
      height: 2,
      rotationRadians: Math.PI / 2,
    };
    const outline = createRectanglePolygon(rectangle);

    expect(outline[0]?.x).toBeCloseTo(11);
    expect(outline[0]?.y).toBeCloseTo(8);
    expect(outline[2]?.x).toBeCloseTo(9);
    expect(outline[2]?.y).toBeCloseTo(12);
    expect(
      shapesIntersect(rectangle, {
        kind: 'circle',
        center: { x: 12, y: 10 },
        radius: 1,
      }),
    ).toBe(true);
    expect(
      shapesIntersect(rectangle, {
        kind: 'circle',
        center: { x: 14, y: 10 },
        radius: 1,
      }),
    ).toBe(false);
  });

  it('rejects invalid circles and rectangles', () => {
    expect(() =>
      circlesIntersect(
        { center: { x: 0, y: 0 }, radius: -1 },
        { center: { x: 0, y: 0 }, radius: 1 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      createRectanglePolygon({
        center: { x: 0, y: 0 },
        width: 0,
        height: 2,
        rotationRadians: 0,
      }),
    ).toThrow(RangeError);
  });
});

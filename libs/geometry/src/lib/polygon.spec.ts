import { describe, expect, it } from 'vitest';
import {
  closestPointOnPolygonBoundary,
  distanceToPolygonBoundary,
  isPointInPolygon,
  polygonArea,
  polygonBounds,
  polygonWinding,
  signedPolygonArea,
  type Polygon,
} from './polygon.js';

const rectangle: Polygon = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 3 },
  { x: 0, y: 3 },
];

describe('polygons', () => {
  it('measures area and winding in Y-down coordinates', () => {
    expect(signedPolygonArea(rectangle)).toBe(12);
    expect(polygonArea(rectangle)).toBe(12);
    expect(polygonWinding(rectangle)).toBe('clockwise');
    expect(signedPolygonArea([...rectangle].reverse())).toBe(-12);
    expect(polygonWinding([...rectangle].reverse())).toBe('counterclockwise');
    expect(polygonBounds(rectangle)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 3,
    });
  });

  it('supports a repeated closing vertex', () => {
    const closed: Polygon = [...rectangle, { x: 0, y: 0 }];

    expect(polygonArea(closed)).toBe(12);
    expect(isPointInPolygon(closed, { x: 2, y: 1 })).toBe(true);
    expect(closestPointOnPolygonBoundary(closed, { x: 6, y: 2 })).toEqual({
      x: 4,
      y: 2,
    });
  });

  it('includes edges and vertices and excludes the notch of a concave polygon', () => {
    const concave: Polygon = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];

    expect(polygonArea(concave)).toBe(7);
    expect(isPointInPolygon(concave, { x: 3, y: 0.5 })).toBe(true);
    expect(isPointInPolygon(concave, { x: 0.5, y: 3 })).toBe(true);
    expect(isPointInPolygon(concave, { x: 3, y: 3 })).toBe(false);
    expect(isPointInPolygon(concave, { x: 1, y: 2 })).toBe(true);
    expect(isPointInPolygon(concave, { x: 1, y: 1 })).toBe(true);
    expect(isPointInPolygon(concave, { x: -1, y: 2 })).toBe(false);
  });

  it('finds the nearest point on an edge or at a corner', () => {
    expect(closestPointOnPolygonBoundary(rectangle, { x: 2, y: 1 })).toEqual({
      x: 2,
      y: 0,
    });
    expect(distanceToPolygonBoundary(rectangle, { x: 2, y: 1 })).toBe(1);
    expect(closestPointOnPolygonBoundary(rectangle, { x: 6, y: 2 })).toEqual({
      x: 4,
      y: 2,
    });
    expect(distanceToPolygonBoundary(rectangle, { x: 6, y: 2 })).toBe(2);
    expect(closestPointOnPolygonBoundary(rectangle, { x: 6, y: 5 })).toEqual({
      x: 4,
      y: 3,
    });
    expect(distanceToPolygonBoundary(rectangle, { x: 6, y: 5 })).toBeCloseTo(
      Math.sqrt(8),
    );
  });

  it('handles empty and degenerate vertex lists', () => {
    const point: Polygon = [{ x: 2, y: 3 }];
    const segment: Polygon = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ];

    expect(signedPolygonArea([])).toBe(0);
    expect(polygonBounds([])).toBeNull();
    expect(isPointInPolygon([], { x: 0, y: 0 })).toBe(false);
    expect(closestPointOnPolygonBoundary([], { x: 0, y: 0 })).toBeNull();
    expect(distanceToPolygonBoundary([], { x: 0, y: 0 })).toBeNull();
    expect(polygonWinding(point)).toBe('degenerate');
    expect(polygonBounds(point)).toEqual({
      minX: 2,
      minY: 3,
      maxX: 2,
      maxY: 3,
    });
    expect(isPointInPolygon(point, { x: 2, y: 3 })).toBe(true);
    expect(isPointInPolygon(point, { x: 2, y: 4 })).toBe(false);
    expect(closestPointOnPolygonBoundary(point, { x: 5, y: 7 })).toEqual({
      x: 2,
      y: 3,
    });
    expect(distanceToPolygonBoundary(point, { x: 5, y: 7 })).toBe(5);
    expect(polygonWinding(segment)).toBe('degenerate');
    expect(isPointInPolygon(segment, { x: 2, y: 0 })).toBe(true);
    expect(isPointInPolygon(segment, { x: 2, y: 1 })).toBe(false);
    expect(closestPointOnPolygonBoundary(segment, { x: 2, y: 3 })).toEqual({
      x: 2,
      y: 0,
    });
  });
});

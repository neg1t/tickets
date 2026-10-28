import { describe, expect, it } from 'vitest';
import {
  hitSeatSymbol,
  seatLevelOfDetail,
  seatSymbolBounds,
} from './seatGeometry.js';

describe('renderer-neutral seat geometry', () => {
  it('uses circular bounds and hit targets regardless of facing rotation', () => {
    const seat = {
      position: { x: 10, y: 20 },
      rotationRadians: Math.PI / 2,
      visualKind: 'chair' as const,
    };
    const bounds = seatSymbolBounds(seat);

    expect(bounds.minX).toBeCloseTo(9.25);
    expect(bounds.maxX).toBeCloseTo(10.75);
    expect(bounds.minY).toBeCloseTo(19.25);
    expect(bounds.maxY).toBeCloseTo(20.75);
    expect(hitSeatSymbol(seat, { x: 10.5, y: 19.7 })).toBe(true);
    expect(hitSeatSymbol(seat, { x: 10.65, y: 20.65 })).toBe(false);
    expect(seatSymbolBounds({ ...seat, rotationRadians: 0 })).toEqual(bounds);
  });

  it('uses shared projected-size thresholds for seat detail', () => {
    expect(seatLevelOfDetail(3)).toBe('dot');
    expect(seatLevelOfDetail(8)).toBe('silhouette');
    expect(seatLevelOfDetail(20)).toBe('full');
  });
});

import { describe, expect, it } from 'vitest';
import {
  hitSeatSymbol,
  seatLevelOfDetail,
  seatSymbolBounds,
} from './seatGeometry.js';

describe('renderer-neutral seat geometry', () => {
  it('calculates rotated bounds and uses them for precise symbol hits', () => {
    const seat = {
      position: { x: 10, y: 20 },
      rotationRadians: Math.PI / 2,
      visualKind: 'chair' as const,
    };
    const bounds = seatSymbolBounds(seat);

    expect(bounds.minX).toBeCloseTo(9.25);
    expect(bounds.maxX).toBeCloseTo(10.75);
    expect(bounds.minY).toBeCloseTo(19.35);
    expect(bounds.maxY).toBeCloseTo(20.65);
    expect(hitSeatSymbol(seat, { x: 10.6, y: 19.4 })).toBe(true);
    expect(hitSeatSymbol(seat, { x: 10.7, y: 20.7 })).toBe(false);
  });

  it('uses shared projected-size thresholds for seat detail', () => {
    expect(seatLevelOfDetail(3)).toBe('dot');
    expect(seatLevelOfDetail(8)).toBe('silhouette');
    expect(seatLevelOfDetail(20)).toBe('full');
  });
});

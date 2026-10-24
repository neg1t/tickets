import { describe, expect, it } from 'vitest';
import {
  seatSymbolBounds,
  hitSeatSymbol,
  seatLevelOfDetail,
  shouldShowSeatLabel,
  visibleSeatLabelIds,
} from './furniture.js';

describe('seat furniture', () => {
  it('rotates chair bounds with its facing direction', () => {
    const seat = {
      position: { x: 10, y: 20 },
      visualKind: 'chair' as const,
      rotationRadians: Math.PI / 2,
    };
    const bounds = seatSymbolBounds(seat);
    expect(bounds.minX).toBeCloseTo(9.25);
    expect(bounds.maxX).toBeCloseTo(10.75);
    expect(bounds.minY).toBeCloseTo(19.35);
    expect(bounds.maxY).toBeCloseTo(20.65);
    expect(hitSeatSymbol(seat, { x: 10.7, y: 20 }, 0)).toBe(true);
    expect(hitSeatSymbol(seat, { x: 10.9, y: 20 }, 0)).toBe(false);
  });

  it('uses silhouette and touch tolerance for armchairs and wheelchair bays', () => {
    const armchair = {
      position: { x: 0, y: 0 },
      visualKind: 'armchair' as const,
    };
    expect(hitSeatSymbol(armchair, { x: 0.68, y: 0 }, 0)).toBe(true);
    expect(hitSeatSymbol(armchair, { x: 0.9, y: 0 }, 0)).toBe(false);
    expect(hitSeatSymbol(armchair, { x: 0.9, y: 0 }, 0.25)).toBe(true);
    const bay = {
      position: { x: 0, y: 0 },
      visualKind: 'wheelchairBay' as const,
    };
    expect(hitSeatSymbol(bay, { x: 0.78, y: 0.78 }, 0)).toBe(true);
  });

  it('selects detail by projected furniture size and suppresses colliding labels', () => {
    expect(seatLevelOfDetail(0.5)).toBe('dot');
    expect(seatLevelOfDetail(5)).toBe('silhouette');
    expect(seatLevelOfDetail(20)).toBe('full');
    expect(shouldShowSeatLabel('A12', 1.3, 10)).toBe(false);
    expect(shouldShowSeatLabel('A12', 1.3, 28)).toBe(true);
    expect(shouldShowSeatLabel('A12', 1.3, 28, 16)).toBe(false);
  });

  it('uses each symbol width for projected detail', () => {
    expect(seatLevelOfDetail(3.9, 'chair')).toBe('dot');
    expect(seatLevelOfDetail(3.9, 'wheelchairBay')).toBe('silhouette');
  });

  it('keeps one readable label when neighboring seats overlap on screen', () => {
    const seats = [
      { id: 'a', label: 'A12', position: { x: 0, y: 0 } },
      { id: 'b', label: 'A13', position: { x: 0.5, y: 0 } },
      { id: 'c', label: 'A14', position: { x: 3, y: 0 } },
    ];
    expect(visibleSeatLabelIds(seats, 28)).toEqual(new Set(['a', 'c']));
  });

  it('accounts for label height as zoom changes', () => {
    const seats = [
      { id: 'a', label: '1', position: { x: 0, y: 0 } },
      { id: 'b', label: '2', position: { x: 0, y: 0.4 } },
    ];
    expect(visibleSeatLabelIds(seats, 100)).toEqual(new Set(['a']));
  });

  it('culls labels outside the visible viewport', () => {
    const seats = [
      { id: 'inside', label: '1', position: { x: 0, y: 0 } },
      { id: 'outside', label: '2', position: { x: 100, y: 0 } },
    ];
    expect(
      visibleSeatLabelIds(seats, 28, { x: 50, y: 50, width: 100, height: 100 }),
    ).toEqual(new Set(['inside']));
  });
});

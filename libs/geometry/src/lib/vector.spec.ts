import { describe, expect, it } from 'vitest';
import {
  addVectors,
  crossVectors,
  distanceBetweenVectors,
  dotVectors,
  lerpVectors,
  normalizeVector,
  scaleVector,
  subtractVectors,
  vectorLength,
  vectorLengthSquared,
  type Vector2,
} from './vector.js';

describe('2D vectors', () => {
  it('adds and subtracts without changing its inputs', () => {
    const first: Vector2 = { x: 3, y: -4 };
    const second: Vector2 = { x: -2, y: 5 };

    expect(addVectors(first, second)).toEqual({ x: 1, y: 1 });
    expect(subtractVectors(first, second)).toEqual({ x: 5, y: -9 });
    expect(first).toEqual({ x: 3, y: -4 });
    expect(second).toEqual({ x: -2, y: 5 });
  });

  it('scales and measures length and distance in world units', () => {
    expect(scaleVector({ x: 3, y: 4 }, -2)).toEqual({ x: -6, y: -8 });
    expect(vectorLengthSquared({ x: 3, y: 4 })).toBe(25);
    expect(vectorLength({ x: 3, y: 4 })).toBe(5);
    expect(distanceBetweenVectors({ x: 1, y: 2 }, { x: 4, y: 6 })).toBe(5);
  });

  it('computes dot and signed cross products in a Y-down coordinate system', () => {
    expect(dotVectors({ x: 2, y: 3 }, { x: 4, y: -1 })).toBe(5);
    expect(crossVectors({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(crossVectors({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
  });

  it('normalizes a nonzero vector and handles zero without NaN', () => {
    const normalized = normalizeVector({ x: 3, y: 4 });
    expect(normalized?.x).toBeCloseTo(0.6);
    expect(normalized?.y).toBeCloseTo(0.8);
    expect(normalizeVector({ x: Number.MIN_VALUE, y: 0 })).toEqual({
      x: 1,
      y: 0,
    });
    expect(normalizeVector({ x: 0, y: 0 })).toBeNull();
  });

  it('interpolates and extrapolates between vectors', () => {
    const first = { x: 2, y: 4 };
    const second = { x: 10, y: -4 };

    expect(lerpVectors(first, second, 0)).toEqual(first);
    expect(lerpVectors(first, second, 0.25)).toEqual({ x: 4, y: 2 });
    expect(lerpVectors(first, second, 1)).toEqual(second);
    expect(lerpVectors(first, second, 1.5)).toEqual({ x: 14, y: -8 });
  });
});

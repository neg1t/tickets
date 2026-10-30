import { describe, expect, it } from 'vitest';
import {
  backgroundScaleFromPercent,
  backgroundScaleForDistance,
  backgroundScalePercent,
  scaleBackgroundAroundCenter,
  fitBackgroundToPageSize,
} from './backgroundScale.js';

describe('background scale', () => {
  it('shows an imported thousandth scale as 100 percent', () => {
    expect(backgroundScalePercent(0.005, 0.005)).toBe(100);
  });

  it('preserves fractional scale when converting a percentage', () => {
    expect(backgroundScaleFromPercent(0.005, 200)).toBe(0.01);
  });

  it('fits scale to a measured distance between points', () => {
    expect(backgroundScaleForDistance(0.005, 10, 20)).toBe(0.01);
    expect(() => backgroundScaleForDistance(1, 0, 20)).toThrow(RangeError);
  });

  it('rejects non-positive and non-finite scale inputs', () => {
    expect(() => backgroundScaleFromPercent(0, 100)).toThrow(RangeError);
    expect(() => backgroundScaleFromPercent(1, Infinity)).toThrow(RangeError);
    expect(() => backgroundScalePercent(1, NaN)).toThrow(RangeError);
  });

  it('keeps the background center fixed as its scale changes', () => {
    const position = scaleBackgroundAroundCenter(
        { x: 10, y: 20 },
        2,
        4,
        { width: 100, height: 50 },
        Math.PI / 2,
      );
    expect(position.x).toBeCloseTo(60);
    expect(position.y).toBeCloseTo(-80);
  });

  it('keeps the page center and width when replacing the source PDF', () => {
    const next = fitBackgroundToPageSize(
      { position: { x: 0, y: 0 }, scale: 0.1, rotationRadians: 0 },
      { width: 300, height: 200 },
      { width: 600, height: 400 },
    );
    expect(next.scale).toBe(0.05);
    expect(next.position.x + 600 * next.scale / 2).toBeCloseTo(15);
    expect(next.position.y + 400 * next.scale / 2).toBeCloseTo(10);
  });
});

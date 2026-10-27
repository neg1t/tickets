import { describe, expect, it } from 'vitest';
import { canvasPixelSize } from './canvasSize.js';

describe('WebGL canvas pixel budget', () => {
  it('caps device pixel ratio and total backing pixels', () => {
    expect(canvasPixelSize(800, 600, 3)).toEqual({
      width: 1600,
      height: 1200,
      pixelRatio: 2,
    });
    const large = canvasPixelSize(6000, 4000, 2);
    expect(large.pixelRatio).toBeLessThan(1);
    expect(large.width * large.height).toBeLessThanOrEqual(16_777_216);
  });
});

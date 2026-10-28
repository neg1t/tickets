import { describe, expect, it } from 'vitest';
import { canvasPixelSize, resizeCanvasBackingStore } from './canvasSize.js';

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

  it('does not reset a backing store when its dimensions are unchanged', () => {
    const canvas = { width: 640, height: 480 };

    expect(
      resizeCanvasBackingStore(canvas, {
        width: 640,
        height: 480,
        pixelRatio: 1,
      }),
    ).toBe(false);
    expect(canvas).toEqual({ width: 640, height: 480 });

    expect(
      resizeCanvasBackingStore(canvas, {
        width: 1280,
        height: 960,
        pixelRatio: 2,
      }),
    ).toBe(true);
    expect(canvas).toEqual({ width: 1280, height: 960 });
  });
});

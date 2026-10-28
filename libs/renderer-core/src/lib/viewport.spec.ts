import { describe, expect, it } from 'vitest';
import {
  fitViewport,
  resizeViewportPreservingCenter,
  screenToWorld,
  zoomViewportAt,
} from './viewport.js';

describe('renderer viewport transforms', () => {
  it('keeps the world point under the cursor while zooming', () => {
    const viewport = { x: 30, y: -20, scale: 2 };
    const cursor = { x: 210, y: 100 };
    const worldPoint = screenToWorld(viewport, cursor);

    expect(
      screenToWorld(zoomViewportAt(viewport, cursor, 1.5), cursor),
    ).toEqual(worldPoint);
  });

  it('fits bounds in the viewport while keeping their center centered', () => {
    const viewport = fitViewport(
      { minX: 0, minY: 10, maxX: 50, maxY: 30 },
      600,
      360,
      30,
    );

    expect(viewport.scale).toBe(10.8);
    expect(screenToWorld(viewport, { x: 300, y: 180 })).toEqual({
      x: 25,
      y: 20,
    });
  });

  it('fits very large world bounds and keeps the first wheel zoom continuous', () => {
    const viewport = fitViewport(
      { minX: -5_000_000, minY: -2_500_000, maxX: 5_000_000, maxY: 2_500_000 },
      600,
      360,
      30,
    );

    expect(viewport.scale).toBeLessThan(0.0001);
    expect(viewport.scale).toBeGreaterThan(0);
    expect(screenToWorld(viewport, { x: 300, y: 180 })).toEqual({ x: 0, y: 0 });

    const zoomed = zoomViewportAt(viewport, { x: 300, y: 180 }, 1.1);
    expect(zoomed.scale).toBeGreaterThan(viewport.scale);
    expect(zoomed.scale).toBeLessThan(viewport.scale * 1.11);
    expect(screenToWorld(zoomed, { x: 300, y: 180 })).toEqual({ x: 0, y: 0 });
  });

  it('preserves the world point at the viewport center when resized', () => {
    const viewport = { x: 30, y: -20, scale: 2, revision: 8 };
    const resized = resizeViewportPreservingCenter(viewport, 200, 100, 300, 200);

    expect(resized.scale).toBe(2);
    expect(resized.revision).toBe(8);
    expect(screenToWorld(resized, { x: 150, y: 100 })).toEqual({ x: 35, y: 35 });
  });
});

import { describe, expect, it } from 'vitest';
import { fitViewport, screenToWorld, zoomViewportAt } from './viewport.js';

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
});

import { fitViewport, screenToWorld, zoomViewportAt } from './viewport.js';
import { describe, expect, it } from 'vitest';

describe('hall viewport', () => {
  it('keeps the world point under the cursor when zooming', () => {
    const before = { x: 30, y: -20, scale: 2 };
    const cursor = { x: 210, y: 100 };
    const world = screenToWorld(before, cursor);

    const after = zoomViewportAt(before, cursor, 1.5);

    expect(after.scale).toBe(3);
    expect(screenToWorld(after, cursor)).toEqual(world);
  });

  it('fits a hall into its viewport with padding', () => {
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

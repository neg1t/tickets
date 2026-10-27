import { describe, expect, it } from 'vitest';
import { createRendererScene } from './scene.js';
import { hitTestScene } from './hitTest.js';

describe('renderer hit testing', () => {
  it('uses precise geometry checks and kind priority for overlapping items', () => {
    const scene = createRendererScene(1, [
      {
        id: 'zone',
        floorId: 'main',
        kind: 'zone',
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        geometry: {},
      },
      {
        id: 'seat',
        floorId: 'main',
        kind: 'seat',
        bounds: { minX: 4, minY: 4, maxX: 6, maxY: 6 },
        geometry: {},
      },
    ]);

    const hit = hitTestScene(scene, { x: 5, y: 5 }, () => true, {
      kindPriority: ['seat', 'zone'],
    });

    expect(hit?.id).toBe('seat');
  });

  it('honors floor and kind filters and tolerance around bounds', () => {
    const scene = createRendererScene(1, [
      {
        id: 'other',
        floorId: 'upper',
        kind: 'seat',
        bounds: { minX: 10, minY: 10, maxX: 12, maxY: 12 },
        geometry: {},
      },
      {
        id: 'row',
        floorId: 'main',
        kind: 'row',
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
        geometry: {},
      },
    ]);

    expect(
      hitTestScene(scene, { x: 2.5, y: 1 }, () => true, {
        floorId: 'main',
        allowedKinds: new Set(['row']),
        tolerance: 0.6,
      })?.id,
    ).toBe('row');
    expect(
      hitTestScene(scene, { x: 11, y: 11 }, () => true, {
        floorId: 'main',
      }),
    ).toBeNull();
  });
});

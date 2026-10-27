import { describe, expect, it } from 'vitest';
import { createRendererScene } from '@hall-platform/renderer-core';
import { hitTestSeatScene } from './seatHitTest.js';

describe('WebGL seat hit testing', () => {
  it('respects seat rotation and ignores items on another floor', () => {
    const scene = createRendererScene(1, [
      {
        id: 'rotated',
        floorId: 'lower',
        kind: 'seat',
        bounds: { minX: 1.2, minY: -0.8, maxX: 2.8, maxY: 0.8 },
        geometry: {
          position: { x: 2, y: 0 },
          rotationRadians: Math.PI / 2,
        },
      },
      {
        id: 'other-floor',
        floorId: 'upper',
        kind: 'seat',
        bounds: { minX: -0.8, minY: -0.8, maxX: 0.8, maxY: 0.8 },
        geometry: { position: { x: 0, y: 0 } },
      },
    ]);

    expect(hitTestSeatScene(scene, { x: 2.6, y: 0.6 }, 'lower')).toEqual({
      kind: 'seat',
      id: 'rotated',
    });
    expect(hitTestSeatScene(scene, { x: 0, y: 0 }, 'lower')).toBeNull();
  });
});

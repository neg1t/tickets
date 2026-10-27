import { describe, expect, it } from 'vitest';
import { createSeatScene } from './seatScene.js';

describe('seat scene preparation', () => {
  it('preserves seat ids and floor ids while deriving shared hit bounds', () => {
    const scene = createSeatScene(
      4,
      [
        {
          id: 'seat-1',
          floorId: 'main',
          position: { x: 8, y: 9 },
          rotationRadians: 0,
          visualKind: 'wheelchairBay',
        },
        {
          id: 'seat-2',
          floorId: 'upper',
          position: { x: 1, y: 2 },
        },
      ],
      'main',
    );

    expect(scene.floorId).toBe('main');
    expect(scene.items).toHaveLength(1);
    expect(scene.items[0]).toMatchObject({
      id: 'seat-1',
      floorId: 'main',
      kind: 'seat',
      geometry: { position: { x: 8, y: 9 }, visualKind: 'wheelchairBay' },
      bounds: { minX: 7.2, minY: 8.2, maxX: 8.8, maxY: 9.8 },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createRendererScene, sceneItemKey } from './scene.js';

describe('renderer scene', () => {
  it('indexes immutable geometry by floor, kind, and id', () => {
    const seat = {
      id: 'seat-1',
      floorId: 'floor-1',
      kind: 'seat',
      bounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
      geometry: { x: 2, y: 3, rotation: 0.5 },
    };
    const scene = createRendererScene(7, [seat]);

    expect(scene.revision).toBe(7);
    expect(scene.items).toEqual([seat]);
    expect(scene.itemByKey.get(sceneItemKey(seat))).toEqual(seat);
    expect(
      scene.index.search(seat.bounds).map(({ value }) => value.id),
    ).toEqual(['seat-1']);
  });

  it('rejects duplicate scene item keys instead of silently replacing geometry', () => {
    const duplicate = {
      id: 'same',
      floorId: 'floor-1',
      kind: 'seat',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      geometry: {},
    };

    expect(() => createRendererScene(1, [duplicate, duplicate])).toThrow(
      'Duplicate renderer scene item',
    );
  });
});

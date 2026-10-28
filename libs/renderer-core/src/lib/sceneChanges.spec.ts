import { describe, expect, it } from 'vitest';
import { createRendererScene } from './scene.js';
import { diffRendererScenes } from './sceneChanges.js';

const identity = { documentId: 'doc-1', sessionId: 'session-1' } as const;

function item(id: string, x: number) {
  return {
    id,
    floorId: 'main',
    kind: 'seat',
    bounds: { minX: x - 1, minY: -1, maxX: x + 1, maxY: 1 },
    geometry: { position: { x, y: 0 } },
  };
}

describe('renderer scene changes', () => {
  it('describes only changed item geometry and carries the next revision', () => {
    const previous = createRendererScene(
      4,
      [item('a', 0), item('b', 2)],
      'main',
      identity,
    );
    const next = createRendererScene(
      5,
      [item('a', 3), item('c', 4)],
      'main',
      identity,
    );

    const styles = [{ id: 'c', status: 'blocked' }] as const;
    const changes = diffRendererScenes(previous, next, styles);

    expect(changes).toMatchObject({
      identity,
      baseRevision: 4,
      revision: 5,
      orderChanged: false,
      added: [expect.objectContaining({ id: 'c' })],
      updated: [expect.objectContaining({ id: 'a' })],
      removed: ['["main","seat","b"]'],
      styles,
    });
  });

  it('marks a document, session, or floor transition as a full replacement', () => {
    const previous = createRendererScene(4, [item('a', 0)], 'main', identity);
    const otherDocument = createRendererScene(5, [item('a', 0)], 'main', {
      ...identity,
      documentId: 'doc-2',
    });
    const otherFloor = createRendererScene(
      5,
      [item('a', 0)],
      'balcony',
      identity,
    );

    expect(diffRendererScenes(previous, otherDocument).replace).toBe(true);
    expect(diffRendererScenes(previous, otherFloor).replace).toBe(true);
  });

  it('marks changed item order so renderers can rebuild the draw order', () => {
    const first = item('a', 0);
    const second = item('b', 2);
    const previous = createRendererScene(4, [first, second], 'main', identity);
    const next = createRendererScene(
      5,
      [
        { ...second, geometry: { position: { x: 2, y: 0 } } },
        { ...first, geometry: { position: { x: 0, y: 0 } } },
      ],
      'main',
      identity,
    );

    const changes = diffRendererScenes(previous, next);

    expect(changes.orderChanged).toBe(true);
    expect(changes.replace).toBe(false);
  });

  it('tracks source IDs removed outside the active floor', () => {
    const activeSeat = item('a', 0);
    const previous = createRendererScene(4, [activeSeat], 'main', identity, [
      'a',
      'off-floor-seat',
    ]);
    const next = createRendererScene(5, [activeSeat], 'main', identity, ['a']);

    expect(diffRendererScenes(previous, next).removedSourceIds).toEqual([
      'off-floor-seat',
    ]);
  });
});

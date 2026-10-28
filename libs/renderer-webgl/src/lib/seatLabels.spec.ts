import { describe, expect, it, vi } from 'vitest';
import {
  createSeatScene,
} from '@hall-platform/renderer-core';
import { drawSeatLabels } from './seatLabels.js';

function context(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('WebGL seat label overlay', () => {
  it('draws only labelled seats in the visible active floor at readable zoom', () => {
    const scene = createSeatScene(
      1,
      [
        { id: 'visible', floorId: 'main', position: { x: 0, y: 0 } },
        { id: 'offscreen', floorId: 'main', position: { x: 100, y: 0 } },
        { id: 'other-floor', floorId: 'upper', position: { x: 0, y: 0 } },
      ],
      'main',
    );
    const draw = context();

    const count = drawSeatLabels(
      draw,
      scene,
      new Map([
        ['visible', 'A1'],
        ['offscreen', 'A2'],
      ]),
      { x: 50, y: 50, scale: 20 },
      100,
      100,
    );

    expect(count).toBe(1);
    expect(draw.strokeText).toHaveBeenCalledWith('A1', 50, 50, 30);
    expect(draw.fillText).toHaveBeenCalledWith('A1', 50, 50, 30);
  });

  it('does not create labels below the readable seat zoom', () => {
    const scene = createSeatScene(1, [
      { id: 'visible', floorId: 'main', position: { x: 0, y: 0 } },
    ]);
    const draw = context();

    expect(
      drawSeatLabels(
        draw,
        scene,
        new Map([['visible', 'A1']]),
        { x: 50, y: 50, scale: 8 },
        100,
        100,
      ),
    ).toBe(0);
    expect(draw.fillText).not.toHaveBeenCalled();
  });

  it('places a dragged seat label at its preview position', () => {
    const scene = createSeatScene(1, [
      { id: 'visible', floorId: 'main', position: { x: 0, y: 0 } },
    ]);
    const draw = context();
    const previewPositions = [
      { id: 'visible', position: { x: 1, y: 0 } },
    ] as const;

    drawSeatLabels(
      draw,
      scene,
      new Map([['visible', 'A1']]),
      { x: 50, y: 50, scale: 20 },
      100,
      100,
      previewPositions,
    );

    expect(draw.fillText).toHaveBeenCalledWith('A1', 70, 50, 30);
  });
});

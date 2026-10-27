import { describe, expect, it } from 'vitest';
import {
  advancePinchViewport,
  advancePointerSession,
  beginPointerSession,
  pinchGestureFromPointers,
} from './interaction.js';

describe('renderer pointer sessions', () => {
  const viewport = { x: 100, y: 50, scale: 10 };

  it('starts as a tap, then reports a world-space delta after drag threshold', () => {
    const start = beginPointerSession(7, { x: 120, y: 70 }, viewport);
    expect(
      advancePointerSession(start, { x: 122, y: 70 }, viewport).dragging,
    ).toBe(false);
    expect(
      advancePointerSession(start, { x: 130, y: 70 }, viewport),
    ).toMatchObject({
      dragging: true,
      delta: { x: 1, y: 0 },
    });
  });

  it('ignores a move from another pointer', () => {
    const start = beginPointerSession(7, { x: 120, y: 70 }, viewport);
    expect(advancePointerSession(start, { x: 180, y: 70 }, viewport, 8)).toBe(
      start,
    );
  });

  it('combines two-pointer movement and scale into a pan and zoom', () => {
    const previous = pinchGestureFromPointers([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    const current = pinchGestureFromPointers([
      { x: 120, y: 110 },
      { x: 320, y: 110 },
    ]);
    if (!previous || !current) throw new Error('Expected two-pointer gestures');

    expect(
      advancePinchViewport({ x: 0, y: 0, scale: 1 }, previous, current),
    ).toEqual({
      x: -80,
      y: -90,
      scale: 2,
    });
  });
});

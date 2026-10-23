import { describe, expect, it } from 'vitest';
import {
  beginPointerSession,
  advancePointerSession,
} from './pointerSession.js';

describe('pointer drag session', () => {
  const viewport = { x: 100, y: 50, scale: 10 };

  it('keeps a press as a tap until the movement threshold is crossed', () => {
    const pressed = beginPointerSession(7, { x: 120, y: 70 }, viewport);
    expect(
      advancePointerSession(pressed, { x: 122, y: 70 }, viewport).dragging,
    ).toBe(false);
    const dragged = advancePointerSession(pressed, { x: 130, y: 70 }, viewport);
    expect(dragged.dragging).toBe(true);
    expect(dragged.delta).toEqual({ x: 1, y: 0 });
  });

  it('uses the current viewport to preserve the world grab point after a pan or zoom', () => {
    const pressed = beginPointerSession(7, { x: 120, y: 70 }, viewport);
    const changedViewport = { x: 110, y: 50, scale: 20 };
    const dragged = advancePointerSession(
      pressed,
      { x: 170, y: 90 },
      changedViewport,
    );
    expect(dragged.delta).toEqual({ x: 1, y: 0 });
  });

  it('ignores moves from a different pointer', () => {
    const pressed = beginPointerSession(7, { x: 120, y: 70 }, viewport);
    expect(advancePointerSession(pressed, { x: 180, y: 70 }, viewport, 8)).toBe(
      pressed,
    );
  });
});

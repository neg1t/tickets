import { describe, expect, it, vi } from 'vitest';
import { CameraController } from './cameraController.js';
import { normalizeWheelDelta, wheelZoomFactor } from './viewport.js';

function frameScheduler() {
  let callback: ((time: number) => void) | null = null;
  let nextFrame = 0;
  const requestFrame = vi.fn((next: (time: number) => void) => {
    callback = next;
    nextFrame += 1;
    return nextFrame;
  });
  const cancelFrame = vi.fn();
  return {
    requestFrame,
    cancelFrame,
    flushFrame: () => {
      const pending = callback;
      callback = null;
      pending?.(16);
    },
  };
}

describe('CameraController', () => {
  it('coalesces updates into one camera revision per animation frame', () => {
    const scheduler = frameScheduler();
    const controller = new CameraController(
      { x: 0, y: 0, scale: 1 },
      scheduler.requestFrame,
      scheduler.cancelFrame,
    );
    const listener = vi.fn();
    const target = vi.fn();
    controller.subscribe(listener);
    controller.attach(target);

    controller.update({ x: 10, y: 20, scale: 1 });
    controller.update((current) => ({ ...current, x: current.x + 5 }));

    expect(scheduler.requestFrame).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual({ x: 0, y: 0, scale: 1, revision: 0 });
    expect(controller.peek()).toEqual({ x: 15, y: 20, scale: 1, revision: 1 });

    scheduler.flushFrame();

    expect(controller.getSnapshot()).toEqual({ x: 15, y: 20, scale: 1, revision: 1 });
    expect(target).toHaveBeenLastCalledWith(controller.getSnapshot());
    expect(listener).toHaveBeenCalledOnce();
  });

  it('applies one snapshot to every registered renderer target before subscribers', () => {
    const scheduler = frameScheduler();
    const controller = new CameraController(
      { x: 0, y: 0, scale: 1 },
      scheduler.requestFrame,
      scheduler.cancelFrame,
    );
    const applied: number[] = [];
    controller.attach(({ revision }) => applied.push(revision));
    controller.attach(({ revision }) => applied.push(revision));
    controller.subscribe(() => applied.push(controller.getSnapshot().revision));

    controller.update({ x: 2, y: 3, scale: 4 });
    scheduler.flushFrame();

    expect(applied).toEqual([0, 0, 1, 1, 1]);
  });
});

describe('wheel camera input', () => {
  it('normalizes pixel, line, and page wheel deltas to CSS pixels', () => {
    expect(normalizeWheelDelta(3, 0, 16, 700)).toBe(3);
    expect(normalizeWheelDelta(3, 1, 16, 700)).toBe(48);
    expect(normalizeWheelDelta(1, 2, 16, 700)).toBe(700);
  });

  it('treats Ctrl+wheel as a slightly stronger zoom gesture', () => {
    const regular = wheelZoomFactor(10, 0, false, 16, 700);
    const ctrl = wheelZoomFactor(10, 0, true, 16, 700);

    expect(regular).toBeLessThan(1);
    expect(ctrl).toBeLessThan(regular);
  });
});

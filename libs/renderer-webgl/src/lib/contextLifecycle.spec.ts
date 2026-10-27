import { describe, expect, it, vi } from 'vitest';
import { observeWebGLContext } from './contextLifecycle.js';

describe('WebGL context lifecycle', () => {
  it('prevents the browser default on loss and reports restoration', () => {
    const target = new EventTarget();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const stop = observeWebGLContext(target as HTMLCanvasElement, {
      onLost,
      onRestored,
    });
    const lostEvent = new Event('webglcontextlost', { cancelable: true });
    target.dispatchEvent(lostEvent);
    target.dispatchEvent(new Event('webglcontextrestored'));

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenCalledOnce();
    expect(onRestored).toHaveBeenCalledOnce();

    stop();
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).toHaveBeenCalledOnce();
  });
});

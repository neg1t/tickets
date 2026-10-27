import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSceneForRenderer,
  scheduleRendererScenePreparation,
  selectRendererEngine,
} from './rendererSelection.js';

afterEach(() => vi.unstubAllGlobals());

describe('renderer engine selection', () => {
  it('keeps auto on Canvas until WebGL rollout is enabled', () => {
    expect(selectRendererEngine('auto', false)).toBe('canvas');
    expect(selectRendererEngine('auto', true)).toBe('webgl');
  });

  it('supports forced Canvas and WebGL modes', () => {
    expect(selectRendererEngine('canvas', true)).toBe('canvas');
    expect(selectRendererEngine('webgl', false)).toBe('webgl');
  });

  it('falls back to Canvas after a WebGL initialization error', () => {
    expect(selectRendererEngine('webgl', true, true)).toBe('canvas');
    expect(selectRendererEngine('auto', true, true)).toBe('canvas');
  });

  it('skips WebGL scene preparation while Canvas is selected', () => {
    const createScene = vi.fn(() => ({ itemCount: 50_000 }));

    expect(createSceneForRenderer('canvas', createScene)).toBeNull();
    expect(createScene).not.toHaveBeenCalled();
  });

  it('prepares the scene only when WebGL is selected', () => {
    const scene = { itemCount: 50_000 };
    const createScene = vi.fn(() => scene);

    expect(createSceneForRenderer('webgl', createScene)).toBe(scene);
    expect(createScene).toHaveBeenCalledOnce();
  });

  it('prepares WebGL scene data after two animation frames', () => {
    const frames: FrameRequestCallback[] = [];
    let nextFrameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const scene = { itemCount: 50_000 };
    const createScene = vi.fn(() => scene);
    const onReady = vi.fn();

    scheduleRendererScenePreparation('webgl', createScene, onReady);

    expect(createScene).not.toHaveBeenCalled();
    frames.shift()?.(16);
    expect(createScene).not.toHaveBeenCalled();
    frames.shift()?.(32);
    expect(createScene).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(scene);
  });

  it('skips and cancels WebGL scene preparation when Canvas is selected', () => {
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const createScene = vi.fn(() => ({ itemCount: 50_000 }));
    const onReady = vi.fn();

    scheduleRendererScenePreparation('canvas', createScene, onReady);

    expect(requestFrame).not.toHaveBeenCalled();
    expect(createScene).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('cancels deferred scene creation if its renderer unmounts', () => {
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    let nextFrameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const createScene = vi.fn(() => ({ itemCount: 50_000 }));
    const onReady = vi.fn();
    const cancel = scheduleRendererScenePreparation(
      'webgl',
      createScene,
      onReady,
    );

    frames.shift()?.(16);
    cancel();
    frames.shift()?.(32);

    expect(cancelFrame).toHaveBeenCalledWith(2);
    expect(createScene).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});

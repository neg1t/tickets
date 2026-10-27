import { describe, expect, it, vi } from 'vitest';
import {
  createSceneForRenderer,
  selectRendererEngine,
} from './rendererSelection.js';

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
});

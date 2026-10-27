import { describe, expect, it } from 'vitest';
import { selectRendererEngine } from './rendererSelection.js';

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
});

import { describe, expect, it } from 'vitest';
import { levelOfDetailForPixels } from './lod.js';

describe('renderer level of detail', () => {
  it('switches levels using projected screen size thresholds', () => {
    expect(levelOfDetailForPixels(5.99, { silhouette: 6, full: 22 })).toBe(
      'dot',
    );
    expect(levelOfDetailForPixels(6, { silhouette: 6, full: 22 })).toBe(
      'silhouette',
    );
    expect(levelOfDetailForPixels(22, { silhouette: 6, full: 22 })).toBe(
      'full',
    );
  });
});

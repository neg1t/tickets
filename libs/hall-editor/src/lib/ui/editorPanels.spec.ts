import { describe, expect, it } from 'vitest';
import { toggleEditorPanel } from './editorPanels.js';

describe('toggleEditorPanel', () => {
  it('opens the requested panel and closes the previously open panel', () => {
    expect(toggleEditorPanel(null, 'layers')).toBe('layers');
    expect(toggleEditorPanel('layers', 'properties')).toBe('properties');
  });

  it('closes an already open panel', () => {
    expect(toggleEditorPanel('tools', 'tools')).toBeNull();
  });
});

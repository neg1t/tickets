import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from './hallLayoutDraft.js';
import { layoutSnapshotSchema } from './layoutSnapshot.js';
import { withoutBackgrounds, withoutEditorBackgrounds } from './layoutProjection.js';

describe('public layout projection', () => {
  it('removes both PDF and image backgrounds without mutating the snapshot', () => {
    const draft = createEmptyDraft('Hall');
    const floorId = draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Empty draft has no floor');
    const snapshot = layoutSnapshotSchema.parse({
      ...draft.snapshot,
      backgrounds: [
        { id: 'background-pdf', floorId, order: 0, position: { x: 0, y: 0 }, scale: 1, rotationRadians: 0, opacity: 1, visible: true, locked: false, source: { kind: 'pdf' as const, assetId: 'pdf', pageNumber: 1 } },
        { id: 'background-image', floorId, order: 1, position: { x: 0, y: 0 }, scale: 1, rotationRadians: 0, opacity: 1, visible: true, locked: false, source: { kind: 'image' as const, assetId: 'image', mimeType: 'image/png' as const } },
      ],
    });
    const publicSnapshot = withoutBackgrounds(snapshot);
    expect(publicSnapshot.backgrounds).toEqual([]);
    expect(snapshot.backgrounds).toHaveLength(2);
  });

  it('removes editor assets together with background references', () => {
    const draft = createEmptyDraft('Hall');
    const projected = withoutEditorBackgrounds({ ...draft, assets: { unused: { kind: 'pdf', name: 'plan.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=', pages: [{ width: 1, height: 1 }] } } });
    expect(projected.snapshot.backgrounds).toEqual([]);
    expect(projected.assets).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { createEmptyDraft, parseHallLayoutDraft } from './editorDraft.js';

describe('hall draft', () => {
  it('round trips an embedded PDF asset, background transform, and calibration', () => {
    const initial = createEmptyDraft('PDF hall');
    const floorId = initial.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const draft = {
      ...initial,
      assets: {
        'asset-plan': {
          kind: 'pdf' as const,
          name: 'plan.pdf',
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          pages: [{ width: 200, height: 100 }],
        },
      },
      calibration: { millimetersPerWorldUnit: 25 },
      snapshot: {
        ...initial.snapshot,
        backgrounds: [
          {
            id: 'background-plan',
            floorId,
            order: 0,
            position: { x: 12, y: 8 },
            scale: 0.5,
            rotationRadians: Math.PI / 6,
            opacity: 0.7,
            visible: true,
            locked: false,
            source: {
              kind: 'pdf' as const,
              assetId: 'asset-plan',
              pageNumber: 1,
            },
          },
        ],
      },
    };

    expect(parseHallLayoutDraft(JSON.parse(JSON.stringify(draft)))).toEqual(
      draft,
    );
  });

  it('rejects a page outside the embedded PDF', () => {
    const initial = createEmptyDraft('PDF hall');
    const floorId = initial.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const draft = {
      ...initial,
      assets: {
        plan: {
          kind: 'pdf',
          name: 'plan.pdf',
          dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
          pages: [{ width: 200, height: 100 }],
        },
      },
      snapshot: {
        ...initial.snapshot,
        backgrounds: [
          {
            id: 'background-plan',
            floorId,
            order: 0,
            position: { x: 0, y: 0 },
            scale: 1,
            rotationRadians: 0,
            opacity: 1,
            visible: true,
            locked: false,
            source: { kind: 'pdf', assetId: 'plan', pageNumber: 2 },
          },
        ],
      },
    };
    expect(() => parseHallLayoutDraft(draft)).toThrow();
  });
});

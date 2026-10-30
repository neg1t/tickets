import { describe, expect, it } from 'vitest';
import { backgroundSchema } from './background.js';

const baseBackground = {
  id: 'background-1',
  floorId: 'floor-ground',
  order: 0,
  position: { x: 10, y: 20 },
  scale: 1.5,
  rotationRadians: Math.PI / 4,
  opacity: 0.8,
  visible: true,
  locked: false,
};

describe('backgroundSchema', () => {
  it('parses a PDF page and survives JSON serialization', () => {
    const background = backgroundSchema.parse({
      ...baseBackground,
      source: { kind: 'pdf', assetId: 'asset-plan', pageNumber: 2 },
    });

    expect(
      backgroundSchema.parse(JSON.parse(JSON.stringify(background))),
    ).toEqual(background);
  });

  it('accepts an optional scale reference for legacy draft compatibility', () => {
    const legacy = backgroundSchema.parse({
      ...baseBackground,
      source: { kind: 'pdf', assetId: 'asset-plan', pageNumber: 1 },
    });
    expect(legacy.referenceScale).toBeUndefined();
    expect(
      backgroundSchema.parse({ ...legacy, referenceScale: 0.005 }).referenceScale,
    ).toBe(0.005);
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'])(
    'parses an image with MIME type %s',
    (mimeType) => {
      expect(
        backgroundSchema.parse({
          ...baseBackground,
          source: { kind: 'image', assetId: 'asset-image', mimeType },
        }).source,
      ).toEqual({ kind: 'image', assetId: 'asset-image', mimeType });
    },
  );

  it.each([
    { ...baseBackground, id: '' },
    { ...baseBackground, floorId: '' },
    { ...baseBackground, order: -1 },
    { ...baseBackground, position: { x: Infinity, y: 20 } },
    { ...baseBackground, scale: 0 },
    { ...baseBackground, rotationRadians: Infinity },
    { ...baseBackground, opacity: 1.1 },
    { ...baseBackground, source: { kind: 'pdf', assetId: '', pageNumber: 1 } },
    {
      ...baseBackground,
      source: { kind: 'pdf', assetId: 'asset-plan', pageNumber: 0 },
    },
    {
      ...baseBackground,
      source: { kind: 'image', assetId: 'asset-image', mimeType: 'image/gif' },
    },
    {
      ...baseBackground,
      source: {
        kind: 'image',
        assetId: 'asset-image',
        mimeType: 'image/png',
        pageNumber: 1,
      },
    },
  ])('rejects invalid background data: %o', (input) => {
    const source =
      'source' in input
        ? input.source
        : { kind: 'pdf', assetId: 'asset-plan', pageNumber: 1 };
    expect(backgroundSchema.safeParse({ ...input, source }).success).toBe(
      false,
    );
  });
});

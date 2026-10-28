import { describe, expect, it } from 'vitest';
import { readHallMetadata } from './hallMetadata.js';

describe('hall catalog metadata', () => {
  it('summarizes a stored hall without decoding its seat geometry', () => {
    const stored = {
      id: 'hall-1',
      updatedAt: '2026-10-27T00:00:00.000Z',
      revision: 7,
      publishedVersionNumber: 3,
      draft: {
        hallName: 'Большой зал',
        snapshot: {
          seats: new Array(50_000),
          zones: new Array(12),
        },
      },
    };

    expect(readHallMetadata(stored)).toEqual({
      id: 'hall-1',
      name: 'Большой зал',
      updatedAt: '2026-10-27T00:00:00.000Z',
      revision: 7,
      publishedVersionNumber: 3,
      seats: 50_000,
      zones: 12,
    });
  });

  it('skips malformed legacy records instead of trusting raw metadata', () => {
    expect(readHallMetadata({ id: 'broken', draft: null })).toBeNull();
    expect(
      readHallMetadata({
        id: 'hall-1',
        updatedAt: 'invalid date',
        revision: -1,
        publishedVersionNumber: 0,
        draft: { hallName: 'Broken', snapshot: { seats: [], zones: [] } },
      }),
    ).toBeNull();
  });

  it('stores a bounded thumbnail derived from actual seat positions', () => {
    const summary = readHallMetadata({
      id: 'hall-2',
      updatedAt: '2026-10-27T00:00:00.000Z',
      revision: 1,
      publishedVersionNumber: 0,
      draft: {
        hallName: 'Small hall',
        snapshot: {
          seats: [
            { position: { x: 0, y: 0 } },
            { position: { x: 10, y: 2 } },
            { position: { x: 4, y: 9 } },
          ],
          zones: [],
        },
      },
    });

    expect(summary?.thumbnailDataUrl).toMatch(/^data:image\/svg\+xml,/);
    expect(summary?.thumbnailDataUrl?.length).toBeLessThan(32_768);
    const svg = decodeURIComponent(
      summary?.thumbnailDataUrl?.slice('data:image/svg+xml,'.length) ?? '',
    );
    expect(svg).toContain('<circle');
    expect(svg).toContain('viewBox="0 0 240 120"');
  });
});

import { describe, expect, it } from 'vitest';
import {
  createPublishedVersionMetadata,
  readPublishedVersionMetadata,
  readStoredPublishedVersionMetadata,
} from './publishedVersionMetadata.js';

const version = {
  versionId: 'version-1',
  hallId: 'hall-1',
  versionNumber: 2,
  publishedAt: '2026-10-27T00:00:00.000Z',
  layout: {
    snapshot: {
      id: 'snapshot-1',
      seats: [{ id: 'seat-1' }, { id: 'seat-2' }],
    },
  },
};

describe('published version metadata', () => {
  it('creates and validates a compact summary with the published seat IDs', () => {
    const summary = createPublishedVersionMetadata(version);

    expect(summary).toEqual({
      versionId: 'version-1',
      hallId: 'hall-1',
      versionNumber: 2,
      publishedAt: version.publishedAt,
      snapshotId: 'snapshot-1',
      seatIds: ['seat-1', 'seat-2'],
    });
    expect(readPublishedVersionMetadata(summary)).toEqual(summary);
  });

  it('extracts metadata from legacy stored versions without validating full layouts', () => {
    expect(readStoredPublishedVersionMetadata(version)).toEqual(
      createPublishedVersionMetadata(version),
    );
    expect(
      readStoredPublishedVersionMetadata({
        ...version,
        layout: {
          snapshot: { ...version.layout.snapshot, seats: [{ id: 2 }] },
        },
      }),
    ).toBeNull();
  });

  it('rejects invalid IDs and timestamps', () => {
    expect(
      readPublishedVersionMetadata({ ...version, seatIds: [null] }),
    ).toBeNull();
    expect(
      readPublishedVersionMetadata({ ...version, publishedAt: 'invalid' }),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  layoutVersionIdSchema,
  seatIdSchema,
} from '../../../shared/ids/index.js';
import {
  archivePublishedVersion,
  assertPublishedVersionForOccurrence,
  draftLayoutVersionSchema,
  editDraftVersion,
  layoutVersionSchema,
  publishDraftVersion,
} from './layoutVersion.js';

const draft = draftLayoutVersionSchema.parse({
  id: 'version-draft',
  layoutId: 'layout-main',
  versionNumber: 1,
  revision: 0,
  status: 'draft',
  snapshotId: 'snapshot-draft',
  calibration: null,
  publishedAt: null,
});

const soldSeatId = seatIdSchema.parse('seat-sold');
const newVersionId = layoutVersionIdSchema.parse('version-published');

const publication = {
  expectedRevision: 0,
  latestPublishedVersionNumber: 0,
  nextVersionId: newVersionId,
  nextSnapshotId: 'snapshot-published',
  publishedAt: '2026-10-22T08:00:00Z',
  soldSeatIds: [soldSeatId],
  nextSeatIds: [soldSeatId],
};

describe('layout versions', () => {
  it('validates and serializes a draft with separate calibration', () => {
    expect(
      layoutVersionSchema.parse(JSON.parse(JSON.stringify(draft))),
    ).toEqual(draft);
    expect(
      layoutVersionSchema.safeParse({ ...draft, status: 'published' }).success,
    ).toBe(false);
  });

  it('edits only a matching draft revision without changing the original', () => {
    const edited = editDraftVersion(draft, {
      expectedRevision: 0,
      nextSnapshotId: 'snapshot-draft-2',
      calibration: { millimetersPerWorldUnit: 25 },
    });

    expect(edited.revision).toBe(1);
    expect(edited.snapshotId).toBe('snapshot-draft-2');
    expect(edited.calibration?.millimetersPerWorldUnit).toBe(25);
    expect(draft.revision).toBe(0);
    expect(draft.calibration).toBeNull();
  });

  it('rejects stale edits and editing a published version', () => {
    expect(() =>
      editDraftVersion(draft, {
        expectedRevision: 1,
        nextSnapshotId: 'snapshot-draft-2',
        calibration: null,
      }),
    ).toThrow();

    const published = publishDraftVersion(draft, publication);
    expect(() =>
      editDraftVersion(published, {
        expectedRevision: 0,
        nextSnapshotId: 'snapshot-draft-3',
        calibration: null,
      }),
    ).toThrow();
  });

  it('publishes a new version and snapshot while retaining sold seat IDs', () => {
    const published = publishDraftVersion(draft, publication);

    expect(published).toEqual({
      ...draft,
      id: newVersionId,
      snapshotId: 'snapshot-published',
      status: 'published',
      publishedAt: '2026-10-22T08:00:00Z',
    });
    expect(
      layoutVersionSchema.parse(JSON.parse(JSON.stringify(published))),
    ).toEqual(published);
    expect(draft.status).toBe('draft');
  });

  it.each([
    { ...publication, expectedRevision: 1 },
    { ...publication, nextVersionId: draft.id },
    { ...publication, nextSnapshotId: draft.snapshotId },
    { ...publication, nextSeatIds: [] },
  ])('rejects an unsafe publication: %o', (input) => {
    expect(() => publishDraftVersion(draft, input)).toThrow();
  });

  it('archives a published version but keeps its publication time', () => {
    const published = publishDraftVersion(draft, publication);
    const archived = archivePublishedVersion(
      published,
      0,
      '2026-10-23T08:00:00Z',
    );

    expect(archived.status).toBe('archived');
    expect(archived.publishedAt).toBe(published.publishedAt);
    expect(archived.revision).toBe(1);
    expect(published.status).toBe('published');
  });

  it('allows a new occurrence only for the matching published version', () => {
    const published = publishDraftVersion(draft, publication);

    expect(assertPublishedVersionForOccurrence(newVersionId, published)).toBe(
      published,
    );
    expect(() =>
      assertPublishedVersionForOccurrence(draft.id, draft),
    ).toThrow();
    expect(() =>
      assertPublishedVersionForOccurrence(draft.id, published),
    ).toThrow();
  });
});

import { createEmptyDraft } from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';
import {
  createPublishedVersion,
  duplicateHallDraft,
  parseHallExportPackage,
} from './localHallRepository.js';

describe('local hall drafts and publications', () => {
  it('duplicates a hall with a new snapshot and version identity', () => {
    const original = createEmptyDraft('Театр');
    const copy = duplicateHallDraft(original);

    expect(copy.hallName).toBe('Театр (копия)');
    expect(copy.snapshot.id).not.toBe(original.snapshot.id);
    expect(copy.snapshot.layoutVersionId).not.toBe(
      original.snapshot.layoutVersionId,
    );
    expect(copy.snapshot.floors[0]?.layoutVersionId).toBe(
      copy.snapshot.layoutVersionId,
    );
  });

  it('publishes an isolated immutable snapshot with a new version number', () => {
    const draft = createEmptyDraft('Театр');
    const publication = createPublishedVersion(draft, 2);

    expect(publication.hallId).toBe(draft.snapshot.id);
    expect(publication.versionNumber).toBe(3);
    expect(publication.layout.snapshot.id).not.toBe(draft.snapshot.id);
    expect(publication.layout.snapshot.layoutVersionId).toBe(
      publication.versionId,
    );
    expect(publication.layout.snapshot.floors[0]?.layoutVersionId).toBe(
      publication.versionId,
    );
    expect(publication.layout.snapshot.floors).not.toBe(draft.snapshot.floors);
  });

  it('validates a portable package before import', () => {
    const draft = createEmptyDraft('Театр');
    const published = createPublishedVersion(draft, 0);
    const hall = {
      id: draft.snapshot.id,
      draft,
      revision: 1,
      publishedVersionNumber: 1,
      updatedAt: new Date().toISOString(),
    };
    const value = {
      format: 'hall-platform-package',
      schemaVersion: 1,
      hall,
      publishedVersions: [published],
    };
    expect(parseHallExportPackage(value)).toEqual(value);
    expect(() =>
      parseHallExportPackage({ ...value, format: 'unknown' }),
    ).toThrow();
    expect(() =>
      parseHallExportPackage({
        ...value,
        publishedVersions: [{ ...published, hallId: 'other' }],
      }),
    ).toThrow();
  });
});

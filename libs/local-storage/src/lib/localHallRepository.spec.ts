import { createEmptyDraft, layoutSnapshotSchema } from '@hall-platform/domain';
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

  it('keeps editor backgrounds out of published versions while retaining the draft source', () => {
    const empty = createEmptyDraft('Театр');
    const floorId = empty.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Empty draft has no floor');
    const draft = {
      ...empty,
      snapshot: layoutSnapshotSchema.parse({
        ...empty.snapshot,
        backgrounds: [{
          id: 'background-plan',
          floorId,
          order: 0,
          position: { x: 0, y: 0 },
          scale: 0.005,
          referenceScale: 0.005,
          rotationRadians: 0,
          opacity: 1,
          visible: true,
          locked: false,
          source: { kind: 'pdf', assetId: 'asset-plan', pageNumber: 1 },
        }],
      }),
      assets: {
        'asset-plan': {
          kind: 'pdf' as const,
          name: 'plan.pdf',
          dataUrl: 'data:application/pdf;base64,JVBERi0=',
          pages: [{ width: 300, height: 200 }],
        },
      },
    };
    const publication = createPublishedVersion(draft, 0);
    expect(draft.snapshot.backgrounds).toHaveLength(1);
    expect(draft.assets['asset-plan']).toBeDefined();
    expect(publication.layout.snapshot.backgrounds).toEqual([]);
    expect(publication.layout.assets).toEqual({});
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

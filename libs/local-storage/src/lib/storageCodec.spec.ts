import { createEmptyDraft } from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';
import {
  collectRetainedAssetKeys,
  decodeStoredDraft,
  encodeStoredDraft,
  validateStoredHall,
} from './storageCodec.js';

function draftWithPdf() {
  const draft = createEmptyDraft('Hall');
  return {
    ...draft,
    assets: {
      plan: {
        kind: 'pdf' as const,
        name: 'plan.pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0=',
        pages: [{ width: 100, height: 200 }],
      },
    },
  };
}

describe('stored hall codec', () => {
  it('stores PDF bytes once as a Blob reference and restores a portable draft', async () => {
    const draft = draftWithPdf();
    const encoded = await encodeStoredDraft(draft);
    const reference = encoded.draft.assets.plan?.dataUrl;

    expect(reference).toMatch(/^asset:sha256:[a-f0-9]{64}$/);
    expect(encoded.blobs).toHaveLength(1);
    expect(encoded.blobs[0]?.blob).toBeInstanceOf(Blob);
    expect(JSON.stringify(encoded.draft)).not.toContain('JVBERi0=');
    expect(
      await decodeStoredDraft(
        encoded.draft,
        async (key) => encoded.blobs.find((entry) => entry.key === key)?.blob,
      ),
    ).toEqual(draft);
  });

  it('reads legacy inline v1 drafts', async () => {
    const { schemaVersion: _version, ...legacy } = draftWithPdf();
    const result = await decodeStoredDraft(legacy, async () => undefined);
    expect(result.schemaVersion).toBe(2);
    expect(result.assets.plan?.dataUrl).toBe(legacy.assets.plan.dataUrl);
  });

  it('rejects missing referenced blobs without accepting an invalid draft', async () => {
    const encoded = await encodeStoredDraft(draftWithPdf());
    await expect(
      decodeStoredDraft(encoded.draft, async () => undefined),
    ).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('validates stored record metadata and unknown draft schema versions', () => {
    const draft = draftWithPdf();
    const record = {
      id: draft.snapshot.id,
      draft,
      updatedAt: new Date().toISOString(),
      revision: 1,
      publishedVersionNumber: 0,
    };
    expect(validateStoredHall(record)).toEqual(record);
    expect(() => validateStoredHall({ ...record, revision: -1 })).toThrow();
    expect(() =>
      validateStoredHall({ ...record, draft: { ...draft, schemaVersion: 99 } }),
    ).toThrow();
  });

  it('retains asset references from published versions and recovery drafts during collection', async () => {
    const encoded = await encodeStoredDraft(draftWithPdf());
    const key = encoded.blobs[0]?.key;
    if (!key) throw new Error('Expected encoded PDF asset');
    expect(
      collectRetainedAssetKeys([], [{ layout: encoded.draft }], []),
    ).toEqual(new Set([key]));
    expect(
      collectRetainedAssetKeys([], [], [{ draft: encoded.draft }]),
    ).toEqual(new Set([key]));
  });
});

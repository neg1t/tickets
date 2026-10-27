import {
  parseHallLayoutDraft,
  type HallLayoutDraft,
} from '@hall-platform/domain';

export type StorageErrorCode =
  | 'blocked'
  | 'quota'
  | 'corrupt'
  | 'unsupported'
  | 'missing'
  | 'conflict'
  | 'transaction';

export class HallStorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HallStorageError';
  }
}

export type StoredDraft = Omit<HallLayoutDraft, 'assets'> & {
  assets: Record<
    string,
    Omit<HallLayoutDraft['assets'][string], 'dataUrl'> & { dataUrl: string }
  >;
};
export type BlobEntry = { key: string; blob: Blob };
export type StoredHallRecord = {
  id: string;
  draft: StoredDraft;
  updatedAt: string;
  revision: number;
  publishedVersionNumber: number;
};

const DATA_PREFIX = 'data:application/pdf;base64,';
const REF_PREFIX = 'asset:sha256:';

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HallStorageError('corrupt', 'Stored hall record is invalid');
  }
  return value as Record<string, unknown>;
}

function draftWithValidationUrls(value: unknown): unknown {
  const draft = object(value);
  const assets = object(draft.assets ?? {});
  return {
    ...draft,
    assets: Object.fromEntries(
      Object.entries(assets).map(([id, raw]) => {
        const asset = object(raw);
        const dataUrl = asset.dataUrl;
        if (typeof dataUrl !== 'string') {
          throw new HallStorageError('corrupt', `PDF asset ${id} has no data`);
        }
        if (
          dataUrl.startsWith(REF_PREFIX) &&
          !/^asset:sha256:[a-f0-9]{64}$/.test(dataUrl)
        ) {
          throw new HallStorageError(
            'corrupt',
            `PDF asset ${id} has an invalid reference`,
          );
        }
        return [
          id,
          {
            ...asset,
            dataUrl: dataUrl.startsWith(REF_PREFIX)
              ? `${DATA_PREFIX}AA==`
              : dataUrl,
          },
        ];
      }),
    ),
  };
}

export function validateStoredDraft(value: unknown): StoredDraft {
  try {
    parseHallLayoutDraft(draftWithValidationUrls(value));
    const draft = value as StoredDraft;
    return { ...draft, assets: draft.assets ?? {} };
  } catch (error) {
    throw storedDraftFailure(error);
  }
}

export function validateStoredHallEnvelope(value: unknown): StoredHallRecord {
  const record = object(value);
  if (
    typeof record.id !== 'string' ||
    !record.id ||
    typeof record.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(record.updatedAt)) ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 0 ||
    !Number.isSafeInteger(record.publishedVersionNumber) ||
    (record.publishedVersionNumber as number) < 0
  ) {
    throw new HallStorageError('corrupt', 'Stored hall metadata is invalid');
  }
  const draft = object(record.draft);
  if (object(draft.snapshot).id !== record.id) {
    throw new HallStorageError(
      'corrupt',
      'Stored hall ID differs from draft ID',
    );
  }
  return value as StoredHallRecord;
}

export function validateStoredHall(value: unknown): StoredHallRecord {
  const record = validateStoredHallEnvelope(value);
  return { ...record, draft: validateStoredDraft(record.draft) };
}

function storedDraftFailure(error: unknown): HallStorageError {
  if (error instanceof HallStorageError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new HallStorageError(
    message.includes('Unsupported hall draft schema version')
      ? 'unsupported'
      : 'corrupt',
    `Stored hall draft is invalid: ${message}`,
    { cause: error },
  );
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `${DATA_PREFIX}${btoa(binary)}`;
}

export async function encodeStoredDraft(
  draft: HallLayoutDraft,
): Promise<{ draft: StoredDraft; blobs: BlobEntry[] }> {
  const valid = parseHallLayoutDraft(draft);
  const blobs = new Map<string, Blob>();
  const assets: StoredDraft['assets'] = {};
  for (const [id, asset] of Object.entries(valid.assets)) {
    const bytes = base64ToBytes(asset.dataUrl.slice(DATA_PREFIX.length));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const key = `${REF_PREFIX}${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    blobs.set(key, new Blob([bytes], { type: 'application/pdf' }));
    assets[id] = { ...asset, dataUrl: key };
  }
  return {
    draft: { ...valid, assets },
    blobs: Array.from(blobs, ([key, blob]) => ({ key, blob })),
  };
}

export async function decodeStoredDraft(
  value: unknown,
  loadBlob: (key: string) => Promise<Blob | undefined>,
): Promise<HallLayoutDraft> {
  draftWithValidationUrls(value);
  const stored = value as StoredDraft;
  const assets: Record<string, HallLayoutDraft['assets'][string]> = {};
  for (const [id, asset] of Object.entries(stored.assets ?? {})) {
    if (asset.dataUrl.startsWith(REF_PREFIX)) {
      const blob = await loadBlob(asset.dataUrl);
      if (!(blob instanceof Blob)) {
        throw new HallStorageError('corrupt', `PDF asset ${id} is missing`);
      }
      assets[id] = { ...asset, dataUrl: await blobToDataUrl(blob) };
    } else {
      assets[id] = asset as HallLayoutDraft['assets'][string];
    }
  }
  try {
    return parseHallLayoutDraft({ ...stored, assets });
  } catch (error) {
    throw storedDraftFailure(error);
  }
}

export function assetReferences(draft: StoredDraft): Set<string> {
  return new Set(
    Object.values(draft.assets)
      .map((asset) => asset.dataUrl)
      .filter((url) => url.startsWith(REF_PREFIX)),
  );
}

export function collectRetainedAssetKeys(
  halls: { draft: StoredDraft }[],
  versions: { layout: StoredDraft }[],
  recoveries: { draft: StoredDraft }[],
): Set<string> {
  const keys = new Set<string>();
  for (const record of [...halls, ...recoveries]) {
    for (const key of assetReferences(record.draft)) keys.add(key);
  }
  for (const version of versions) {
    for (const key of assetReferences(version.layout)) keys.add(key);
  }
  return keys;
}

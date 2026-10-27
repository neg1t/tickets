export type HallMetadata = Readonly<{
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  publishedVersionNumber: number;
  seats: number;
  zones: number;
}>;

export type HallMetadataSource = Readonly<{
  id: string;
  updatedAt: string;
  revision: number;
  publishedVersionNumber: number;
  draft: Readonly<{
    hallName: string;
    snapshot: Readonly<{
      seats: readonly unknown[];
      zones: readonly unknown[];
    }>;
  }>;
}>;

export function createHallMetadata(record: HallMetadataSource): HallMetadata {
  return {
    id: record.id,
    name: record.draft.hallName,
    updatedAt: record.updatedAt,
    revision: record.revision,
    publishedVersionNumber: record.publishedVersionNumber,
    seats: record.draft.snapshot.seats.length,
    zones: record.draft.snapshot.zones.length,
  };
}

export function readHallMetadata(value: unknown): HallMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const draft = record['draft'];
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const draftRecord = draft as Record<string, unknown>;
  const snapshot = draftRecord['snapshot'];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const snapshotRecord = snapshot as Record<string, unknown>;
  if (
    typeof record['id'] !== 'string' ||
    record['id'].length === 0 ||
    typeof record['updatedAt'] !== 'string' ||
    Number.isNaN(Date.parse(record['updatedAt'])) ||
    !Number.isSafeInteger(record['revision']) ||
    (record['revision'] as number) < 0 ||
    !Number.isSafeInteger(record['publishedVersionNumber']) ||
    (record['publishedVersionNumber'] as number) < 0 ||
    typeof draftRecord['hallName'] !== 'string' ||
    !Array.isArray(snapshotRecord['seats']) ||
    !Array.isArray(snapshotRecord['zones'])
  )
    return null;

  return {
    id: record['id'],
    name: draftRecord['hallName'],
    updatedAt: record['updatedAt'],
    revision: record['revision'] as number,
    publishedVersionNumber: record['publishedVersionNumber'] as number,
    seats: snapshotRecord['seats'].length,
    zones: snapshotRecord['zones'].length,
  };
}

export function validateHallMetadata(value: unknown): HallMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record['id'] !== 'string' ||
    record['id'].length === 0 ||
    typeof record['name'] !== 'string' ||
    typeof record['updatedAt'] !== 'string' ||
    Number.isNaN(Date.parse(record['updatedAt'])) ||
    !Number.isSafeInteger(record['revision']) ||
    (record['revision'] as number) < 0 ||
    !Number.isSafeInteger(record['publishedVersionNumber']) ||
    (record['publishedVersionNumber'] as number) < 0 ||
    !Number.isSafeInteger(record['seats']) ||
    (record['seats'] as number) < 0 ||
    !Number.isSafeInteger(record['zones']) ||
    (record['zones'] as number) < 0
  )
    return null;

  return {
    id: record['id'],
    name: record['name'],
    updatedAt: record['updatedAt'],
    revision: record['revision'] as number,
    publishedVersionNumber: record['publishedVersionNumber'] as number,
    seats: record['seats'] as number,
    zones: record['zones'] as number,
  };
}

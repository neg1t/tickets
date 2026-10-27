export type PublishedVersionMetadata = Readonly<{
  versionId: string;
  hallId: string;
  versionNumber: number;
  publishedAt: string;
  snapshotId: string;
  seatIds: readonly string[];
}>;

export type PublishedVersionMetadataSource = Readonly<{
  versionId: string;
  hallId: string;
  versionNumber: number;
  publishedAt: string;
  layout: Readonly<{
    snapshot: Readonly<{
      id: string;
      seats: readonly Readonly<{ id: string }>[];
    }>;
  }>;
}>;

export function createPublishedVersionMetadata(
  version: PublishedVersionMetadataSource,
): PublishedVersionMetadata {
  return {
    versionId: version.versionId,
    hallId: version.hallId,
    versionNumber: version.versionNumber,
    publishedAt: version.publishedAt,
    snapshotId: version.layout.snapshot.id,
    seatIds: version.layout.snapshot.seats.map((seat) => seat.id),
  };
}

export function readPublishedVersionMetadata(
  value: unknown,
): PublishedVersionMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const seatIds = record['seatIds'];
  if (
    typeof record['versionId'] !== 'string' ||
    !record['versionId'] ||
    typeof record['hallId'] !== 'string' ||
    !record['hallId'] ||
    !Number.isSafeInteger(record['versionNumber']) ||
    (record['versionNumber'] as number) < 1 ||
    typeof record['publishedAt'] !== 'string' ||
    Number.isNaN(Date.parse(record['publishedAt'])) ||
    typeof record['snapshotId'] !== 'string' ||
    !record['snapshotId'] ||
    !Array.isArray(seatIds) ||
    !seatIds.every((id) => typeof id === 'string' && id.length > 0)
  )
    return null;

  return {
    versionId: record['versionId'],
    hallId: record['hallId'],
    versionNumber: record['versionNumber'] as number,
    publishedAt: record['publishedAt'],
    snapshotId: record['snapshotId'],
    seatIds,
  };
}

export function readStoredPublishedVersionMetadata(
  value: unknown,
): PublishedVersionMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const layout = record['layout'];
  if (!layout || typeof layout !== 'object' || Array.isArray(layout))
    return null;
  const snapshot = (layout as Record<string, unknown>)['snapshot'];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  const snapshotRecord = snapshot as Record<string, unknown>;
  const seats = snapshotRecord['seats'];
  if (
    typeof snapshotRecord['id'] !== 'string' ||
    !snapshotRecord['id'] ||
    !Array.isArray(seats)
  )
    return null;
  const seatIds: string[] = [];
  for (const seat of seats) {
    if (!seat || typeof seat !== 'object' || Array.isArray(seat)) return null;
    const id = (seat as Record<string, unknown>)['id'];
    if (typeof id !== 'string' || id.length === 0) return null;
    seatIds.push(id);
  }
  return readPublishedVersionMetadata({
    versionId: record['versionId'],
    hallId: record['hallId'],
    versionNumber: record['versionNumber'],
    publishedAt: record['publishedAt'],
    snapshotId: snapshotRecord['id'],
    seatIds,
  });
}

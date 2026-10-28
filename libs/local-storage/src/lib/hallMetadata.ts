export type HallMetadata = Readonly<{
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  publishedVersionNumber: number;
  seats: number;
  zones: number;
  thumbnailDataUrl?: string;
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

const thumbnailWidth = 240;
const thumbnailHeight = 120;
const maximumThumbnailSeats = 320;

function hallThumbnailDataUrl(seats: readonly unknown[]): string | undefined {
  const floorCounts = new Map<string, number>();
  for (const seat of seats) {
    if (!seat || typeof seat !== 'object') continue;
    const floorId = (seat as { floorId?: unknown }).floorId;
    if (typeof floorId !== 'string') continue;
    floorCounts.set(floorId, (floorCounts.get(floorId) ?? 0) + 1);
  }
  const thumbnailFloor = [...floorCounts].sort(
    (first, second) => second[1] - first[1],
  )[0]?.[0];
  const thumbnailFloorSeatCount = thumbnailFloor
    ? (floorCounts.get(thumbnailFloor) ?? seats.length)
    : seats.length;
  const stride = Math.max(
    1,
    Math.ceil(thumbnailFloorSeatCount / maximumThumbnailSeats),
  );
  const points: { x: number; y: number }[] = [];
  let sampled = 0;
  for (const seat of seats) {
    if (!seat || typeof seat !== 'object') continue;
    const floorId = (seat as { floorId?: unknown }).floorId;
    if (thumbnailFloor && floorId !== thumbnailFloor) continue;
    if (sampled++ % stride !== 0) continue;
    const position = (seat as { position?: unknown }).position;
    if (!position || typeof position !== 'object') continue;
    const { x, y } = position as { x?: unknown; y?: unknown };
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y)
    )
      points.push({ x, y });
  }
  if (points.length === 0) return undefined;

  const minX = Math.min(...points.map(({ x }) => x));
  const maxX = Math.max(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxY = Math.max(...points.map(({ y }) => y));
  const padding = 12;
  const scale = Math.min(
    (thumbnailWidth - padding * 2) / Math.max(maxX - minX, 1),
    (thumbnailHeight - padding * 2) / Math.max(maxY - minY, 1),
  );
  const offsetX = (thumbnailWidth - (maxX - minX) * scale) / 2;
  const offsetY = (thumbnailHeight - (maxY - minY) * scale) / 2;
  const dots = points
    .map(
      ({ x, y }) =>
        `<circle cx="${(offsetX + (x - minX) * scale).toFixed(1)}" cy="${(offsetY + (y - minY) * scale).toFixed(1)}" r="1.8"/>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${thumbnailWidth} ${thumbnailHeight}"><rect width="100%" height="100%" rx="10" fill="#eff3f8"/><g fill="#6484bd">${dots}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function createHallMetadata(record: HallMetadataSource): HallMetadata {
  const thumbnailDataUrl = hallThumbnailDataUrl(record.draft.snapshot.seats);
  return {
    id: record.id,
    name: record.draft.hallName,
    updatedAt: record.updatedAt,
    revision: record.revision,
    publishedVersionNumber: record.publishedVersionNumber,
    seats: record.draft.snapshot.seats.length,
    zones: record.draft.snapshot.zones.length,
    ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
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

  const thumbnailDataUrl = hallThumbnailDataUrl(snapshotRecord['seats']);
  return {
    id: record['id'],
    name: draftRecord['hallName'],
    updatedAt: record['updatedAt'],
    revision: record['revision'] as number,
    publishedVersionNumber: record['publishedVersionNumber'] as number,
    seats: snapshotRecord['seats'].length,
    zones: snapshotRecord['zones'].length,
    ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}),
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
    (record['zones'] as number) < 0 ||
    (record['thumbnailDataUrl'] !== undefined &&
      (typeof record['thumbnailDataUrl'] !== 'string' ||
        record['thumbnailDataUrl'].length > 32_768 ||
        !record['thumbnailDataUrl'].startsWith('data:image/svg+xml,')))
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
    ...(typeof record['thumbnailDataUrl'] === 'string'
      ? { thumbnailDataUrl: record['thumbnailDataUrl'] }
      : {}),
  };
}

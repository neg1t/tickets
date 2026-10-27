export type SeatLevelOfDetail = 'dot' | 'silhouette' | 'full';

export type DetailThresholds = Readonly<{
  silhouette: number;
  full: number;
}>;

/** Classify geometry by its projected pixel size, independent of render engine. */
export function levelOfDetailForPixels(
  projectedSize: number,
  thresholds: DetailThresholds,
): SeatLevelOfDetail {
  if (!Number.isFinite(projectedSize) || projectedSize < thresholds.silhouette)
    return 'dot';
  return projectedSize < thresholds.full ? 'silhouette' : 'full';
}

import type { SeatStatus } from '@hall-platform/domain';

export type SeatAvailabilityMap = Readonly<{
  seats: Readonly<Record<string, SeatStatus>>;
  zones?: Readonly<
    Record<
      string,
      { readonly available: number; readonly maxPerOrder?: number }
    >
  >;
}>;

export type SeatAvailabilityDelta = Readonly<{
  baseRevision: number;
  revision: number;
  seats?: Readonly<Record<string, SeatStatus | null>>;
  zones?: Readonly<
    Record<
      string,
      { readonly available: number; readonly maxPerOrder?: number } | null
    >
  >;
}>;

export type SeatAvailabilityDeltaResult = Readonly<{
  availability: SeatAvailabilityMap;
  revision: number;
  resyncRequired: boolean;
}>;

export function applySeatAvailabilityDeltas(
  snapshot: SeatAvailabilityMap,
  snapshotRevision: number,
  deltas: readonly SeatAvailabilityDelta[],
): SeatAvailabilityDeltaResult {
  if (!Number.isSafeInteger(snapshotRevision) || snapshotRevision < 0)
    return {
      availability: snapshot,
      revision: 0,
      resyncRequired: true,
    };

  let availability = snapshot;
  let revision = snapshotRevision;
  for (const delta of deltas) {
    if (
      !Number.isSafeInteger(delta.revision) ||
      !Number.isSafeInteger(delta.baseRevision) ||
      delta.revision <= delta.baseRevision
    )
      return {
        availability: snapshot,
        revision: snapshotRevision,
        resyncRequired: true,
      };
    if (delta.revision <= revision) continue;
    if (delta.baseRevision !== revision)
      return {
        availability: snapshot,
        revision: snapshotRevision,
        resyncRequired: true,
      };

    const seats = { ...availability.seats };
    for (const [id, status] of Object.entries(delta.seats ?? {})) {
      if (status === null) delete seats[id];
      else seats[id] = status;
    }

    const zones = { ...availability.zones };
    for (const [id, stock] of Object.entries(delta.zones ?? {})) {
      if (stock === null) delete zones[id];
      else zones[id] = stock;
    }
    availability = {
      seats,
      ...(availability.zones !== undefined || delta.zones !== undefined
        ? { zones }
        : {}),
    };
    revision = delta.revision;
  }

  return { availability, revision, resyncRequired: false };
}

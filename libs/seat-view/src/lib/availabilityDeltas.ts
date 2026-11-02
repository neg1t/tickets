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

  let seats = snapshot.seats;
  let mutableSeats: Record<string, SeatStatus> | null = null;
  let zones = snapshot.zones;
  let mutableZones: Record<string, { readonly available: number; readonly maxPerOrder?: number }> | null = null;
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

    if (delta.seats && Object.keys(delta.seats).length > 0) {
      if (!mutableSeats) {
        mutableSeats = { ...seats };
        seats = mutableSeats;
      }
      for (const [id, status] of Object.entries(delta.seats)) {
        if (status === null) delete mutableSeats[id];
        else mutableSeats[id] = status;
      }
    }

    if (delta.zones && Object.keys(delta.zones).length > 0) {
      if (!mutableZones) {
        mutableZones = { ...(zones ?? {}) };
        zones = mutableZones;
      }
      for (const [id, stock] of Object.entries(delta.zones)) {
        if (stock === null) delete mutableZones[id];
        else mutableZones[id] = stock;
      }
    }
    revision = delta.revision;
  }

  return {
    availability: { seats, ...(zones !== undefined ? { zones } : {}) },
    revision,
    resyncRequired: false,
  };
}

import type { LayoutSnapshot } from '@hall-platform/domain';

type Seat = LayoutSnapshot['seats'][number];

export type SeatIndexes = Readonly<{
  floorById: ReadonlyMap<string, LayoutSnapshot['floors'][number]>;
  zoneById: ReadonlyMap<string, LayoutSnapshot['zones'][number]>;
  rowById: ReadonlyMap<string, LayoutSnapshot['rows'][number]>;
  seatById: ReadonlyMap<string, Seat>;
  searchTextById: ReadonlyMap<string, string>;
  seatsByFloor: ReadonlyMap<string, readonly Seat[]>;
  seatsByFloorZone: ReadonlyMap<string, readonly Seat[]>;
}>;

export function buildSeatIndexes(snapshot: LayoutSnapshot): SeatIndexes {
  const floorById = new Map(snapshot.floors.map((floor) => [floor.id, floor]));
  const zoneById = new Map(snapshot.zones.map((zone) => [zone.id, zone]));
  const rowById = new Map(snapshot.rows.map((row) => [row.id, row]));
  const seatById = new Map<string, Seat>();
  const searchTextById = new Map<string, string>();
  const seatsByFloor = new Map<string, Seat[]>();
  const seatsByFloorZone = new Map<string, Seat[]>();

  for (const seat of snapshot.seats) {
    seatById.set(seat.id, seat);
    const floorSeats = seatsByFloor.get(seat.floorId) ?? [];
    floorSeats.push(seat);
    seatsByFloor.set(seat.floorId, floorSeats);
    if (seat.zoneId) {
      const key = `${seat.floorId}\u0000${seat.zoneId}`;
      const zoneSeats = seatsByFloorZone.get(key) ?? [];
      zoneSeats.push(seat);
      seatsByFloorZone.set(key, zoneSeats);
    }
    const rowName =
      seat.placement.kind === 'row'
        ? (rowById.get(seat.placement.rowId)?.name ?? '')
        : '';
    const zoneName = seat.zoneId ? (zoneById.get(seat.zoneId)?.name ?? '') : '';
    searchTextById.set(
      seat.id,
      `${seat.label} ${zoneName} ${rowName}`.toLowerCase(),
    );
  }

  return {
    floorById,
    zoneById,
    rowById,
    seatById,
    searchTextById,
    seatsByFloor,
    seatsByFloorZone,
  };
}

import { describe, expect, it } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import { buildSeatIndexes } from './seatIndexes.js';

describe('buyer seat indexes', () => {
  it('indexes seats in stable floor and zone order and prepares lowercase search text', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const firstSeat = snapshot.seats[0];
    if (!firstSeat) throw new Error('Fixture has no seats');
    const index = buildSeatIndexes(snapshot);
    const floorSeats = index.seatsByFloor.get(firstSeat.floorId);
    expect(floorSeats?.[0]).toBe(firstSeat);
    expect(index.seatById.get(firstSeat.id)).toBe(firstSeat);
    expect(index.searchTextById.get(firstSeat.id)).toContain(
      firstSeat.label.toLowerCase(),
    );
    if (firstSeat.zoneId) {
      const zoneSeats = index.seatsByFloorZone.get(
        `${firstSeat.floorId}\u0000${firstSeat.zoneId}`,
      );
      expect(zoneSeats).toContain(firstSeat);
    }
  });
});

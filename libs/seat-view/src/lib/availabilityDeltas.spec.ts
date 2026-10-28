import { describe, expect, it } from 'vitest';
import {
  applySeatAvailabilityDeltas,
  type SeatAvailabilityDelta,
  type SeatAvailabilityMap,
} from './availabilityDeltas.js';

const snapshot: SeatAvailabilityMap = {
  seats: { a: 'available', b: 'held' },
  zones: { z: { available: 5, maxPerOrder: 4 } },
};

describe('seat availability deltas', () => {
  it('coalesces contiguous revisions into one immutable state update', () => {
    const deltas: SeatAvailabilityDelta[] = [
      { baseRevision: 4, revision: 5, seats: { a: 'sold' } },
      {
        baseRevision: 5,
        revision: 6,
        seats: { b: 'available' },
        zones: { z: { available: 3, maxPerOrder: 2 } },
      },
    ];

    const result = applySeatAvailabilityDeltas(snapshot, 4, deltas);

    expect(result).toEqual({
      availability: {
        seats: { a: 'sold', b: 'available' },
        zones: { z: { available: 3, maxPerOrder: 2 } },
      },
      revision: 6,
      resyncRequired: false,
    });
    expect(snapshot.seats).toEqual({ a: 'available', b: 'held' });
  });

  it('ignores revisions already covered by the full snapshot', () => {
    const result = applySeatAvailabilityDeltas(snapshot, 8, [
      { baseRevision: 7, revision: 8, seats: { a: 'sold' } },
      { baseRevision: 8, revision: 9, seats: { b: 'sold' } },
    ]);

    expect(result).toEqual({
      availability: {
        seats: { a: 'available', b: 'sold' },
        zones: snapshot.zones,
      },
      revision: 9,
      resyncRequired: false,
    });
  });

  it('falls back to the latest full snapshot when a revision gap appears', () => {
    const result = applySeatAvailabilityDeltas(snapshot, 4, [
      { baseRevision: 4, revision: 5, seats: { a: 'sold' } },
      { baseRevision: 7, revision: 8, seats: { b: 'sold' } },
    ]);

    expect(result).toEqual({
      availability: snapshot,
      revision: 4,
      resyncRequired: true,
    });
  });

  it('ignores malformed, non-increasing deltas and requests a snapshot', () => {
    const result = applySeatAvailabilityDeltas(snapshot, 4, [
      { baseRevision: 4, revision: 4, seats: { a: 'sold' } },
    ]);

    expect(result).toEqual({
      availability: snapshot,
      revision: 4,
      resyncRequired: true,
    });
  });
});

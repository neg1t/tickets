import { describe, expect, it } from 'vitest';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import { layoutDocumentSchema } from '@hall-platform/domain';
import { createDemoOccurrence } from './demoBooking.js';
import { parseDemoOccurrence } from './demoBookingRepository.js';

describe('demo booking storage migration', () => {
  it('cancels old live holds and preserves legacy orders without inventing their prices', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const occurrence = createDemoOccurrence('demo-migrate', { hallName: 'Hall', snapshot });
    const seatId = snapshot.seats[0]?.id;
    if (!seatId) throw new Error('Fixture must have at least one seat');
    const legacy = {
      ...occurrence,
      schemaVersion: 1,
      holds: [{
        id: 'legacy-hold',
        selection: [{ kind: 'seat', seatId }],
        expiresAt: Date.now() + 60_000,
      }],
      orders: [{
        id: 'legacy-order',
        selection: [{ kind: 'seat', seatId }],
        confirmedAt: 100,
      }],
    };

    const migrated = parseDemoOccurrence(legacy);
    expect(migrated?.schemaVersion).toBe(2);
    expect(migrated?.holds).toEqual([]);
    expect(migrated?.legacyQuoteNotice).toBe(true);
    expect(migrated?.orders).toEqual([{
      id: 'legacy-order',
      selection: [{ kind: 'seat', seatId }],
      confirmedAt: 100,
      quote: null,
    }]);
    expect(parseDemoOccurrence(migrated)).toEqual(migrated);
  });

  it('rejects a current-schema hold without a validated quote', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const occurrence = createDemoOccurrence('demo-migrate', { hallName: 'Hall', snapshot });
    const seatId = snapshot.seats[0]?.id;
    if (!seatId) throw new Error('Fixture must have at least one seat');
    expect(parseDemoOccurrence({
      ...occurrence,
      holds: [{ id: 'bad-hold', selection: [{ kind: 'seat', seatId }], expiresAt: Date.now() + 60_000 }],
    })).toBeNull();
  });
});

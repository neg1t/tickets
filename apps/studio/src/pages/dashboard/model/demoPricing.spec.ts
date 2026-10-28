import { describe, expect, it } from 'vitest';
import { layoutDocumentSchema, layoutSnapshotSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import banquetHall from '@hall-platform/fixtures/banquet-hall.json';
import { createDemoOccurrence } from './demoBooking.js';
import {
  buildDemoPricingPrices,
  createDemoPricingCatalog,
  createDemoPricingDocument,
} from './demoPricing.js';

describe('demo pricing', () => {
  it('leaves legacy demo prices without inferred segment bindings until explicit assignment', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const occurrence = createDemoOccurrence('demo-pricing', { hallName: 'Hall', snapshot });
    const catalog = createDemoPricingCatalog(occurrence);
    const document = createDemoPricingDocument(occurrence, catalog);

    expect(document.assignments.seatSegments).toEqual({});
    expect(occurrence.prices.seats[snapshot.seats[0]?.id ?? '']?.amount).toBe(1500);
  });

  it('uses only explicit GA zone kind and builds prices only for explicitly assigned targets', () => {
    const sourceSnapshot = layoutDocumentSchema.parse(banquetHall.document).snapshot;
    const emptyZone = sourceSnapshot.zones.find(
      (zone) => !sourceSnapshot.seats.some((seat) => seat.zoneId === zone.id),
    );
    if (!emptyZone) throw new Error('Fixture needs an empty zone for explicit GA setup');
    const snapshot = layoutSnapshotSchema.parse({
      ...sourceSnapshot,
      zones: sourceSnapshot.zones.map((zone) =>
        zone.id === emptyZone.id ? { ...zone, kind: 'ga', capacity: 20 } : zone,
      ),
    });
    const occurrence = createDemoOccurrence('demo-pricing', { hallName: 'Hall', snapshot });
    const catalog = createDemoPricingCatalog(occurrence);
    const seat = snapshot.seats[0];
    const gaZone = snapshot.zones.find(({ kind }) => kind === 'ga');
    if (!seat || !gaZone) throw new Error('Expected a seat and explicit GA zone');
    const document = createDemoPricingDocument(occurrence, catalog, {
      seatSegments: { [seat.id]: 'demo:premium' },
      gaZoneSegments: { [gaZone.id]: 'demo:standard' },
    });
    const prices = buildDemoPricingPrices({ occurrence, catalog, document });

    expect(Object.keys(occurrence.zoneCapacity)).toEqual([gaZone.id]);
    expect(prices.seats[seat.id]).toEqual({ amount: 3500, currency: 'RUB', category: 'Премиум' });
    expect(prices.zones?.[gaZone.id]).toEqual({ amount: 1500, currency: 'RUB', category: 'Стандарт' });
    expect(Object.keys(prices.seats)).toEqual([seat.id]);
  });
});

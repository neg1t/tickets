import { describe, expect, it } from 'vitest';
import { layoutSnapshotSchema, type PricingAssignmentDocument, type PricingCatalog } from '@hall-platform/domain';
import { createPricingPreviewPriceMap } from './pricingPreview.js';

const snapshot = layoutSnapshotSchema.parse({
  id: 'hall',
  layoutVersionId: 'layout-v1',
  floors: [{ id: 'floor', layoutVersionId: 'layout-v1', name: 'Main' }],
  zones: [{ id: 'dance-floor', floorId: 'floor', name: 'Dance floor', kind: 'ga', capacity: 500 }],
  rows: [],
  seats: [{
    id: 'seat-1', floorId: 'floor', zoneId: 'dance-floor', label: 'A1',
    position: { x: 0, y: 0 }, placement: { kind: 'standalone' },
  }],
  tables: [], backgrounds: [], decorations: [],
});
const catalog: PricingCatalog = {
  occurrenceId: 'occ-1', revision: 1,
  items: [{ id: 'standard', name: 'Standard', color: '#336699', status: 'active', price: { amountMinor: 125000, currency: 'RUB' } }],
};
const document: PricingAssignmentDocument = {
  schemaVersion: 1, occurrenceId: 'occ-1', layoutVersionId: 'layout-v1', revision: 0, catalogRevision: 1,
  assignments: { seatSegments: {}, gaZoneSegments: { 'dance-floor': 'standard' } },
};

describe('pricing buyer preview', () => {
  it('converts only validated assignments into SeatView major-unit prices', () => {
    const safeSnapshot = layoutSnapshotSchema.parse({ ...snapshot, seats: [] });
    expect(createPricingPreviewPriceMap({ snapshot: safeSnapshot, catalog, document })).toEqual({
      seats: {},
      zones: { 'dance-floor': { amount: 1250, currency: 'RUB', category: 'Standard' } },
    });
  });

  it('rejects a GA assignment when the layout also contains seats in that zone', () => {
    expect(() => createPricingPreviewPriceMap({ snapshot, catalog, document }))
      .toThrow(/overlaps .* seated targets/i);
  });
});

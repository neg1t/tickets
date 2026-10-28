import { describe, expect, it } from 'vitest';
import { layoutSnapshotSchema } from '../model/layoutSnapshot.js';
import { pricingCatalogSchema } from './pricingCatalog.js';
import {
  pricingAssignmentDocumentSchema,
  validatePricingAssignments,
} from './pricingAssignments.js';

const snapshot = layoutSnapshotSchema.parse({
  id: 'snapshot-1',
  layoutVersionId: 'version-1',
  floors: [{ id: 'floor-1', layoutVersionId: 'version-1', name: 'Main' }],
  zones: [
    { id: 'zone-seated', floorId: 'floor-1', name: 'Seats', kind: 'seated' },
    {
      id: 'zone-ga',
      floorId: 'floor-1',
      name: 'Dance floor',
      kind: 'ga',
      capacity: 500,
    },
  ],
  rows: [],
  seats: [
    {
      id: 'seat-1',
      floorId: 'floor-1',
      zoneId: 'zone-seated',
      label: 'A1',
      position: { x: 1, y: 1 },
      placement: { kind: 'standalone' },
    },
  ],
  tables: [],
  backgrounds: [],
  decorations: [],
});

const catalog = pricingCatalogSchema.parse({
  occurrenceId: 'occ-1',
  revision: 4,
  items: [
    {
      id: 'segment-standard',
      name: 'Standard',
      color: '#336699',
      status: 'active',
      price: { amountMinor: 1000, currency: 'RUB' },
    },
    {
      id: 'segment-old',
      name: 'Old',
      color: '#999999',
      status: 'archived',
      price: { amountMinor: 0, currency: 'RUB' },
    },
  ],
});

const document = {
  schemaVersion: 1,
  occurrenceId: 'occ-1',
  layoutVersionId: 'version-1',
  revision: 3,
  catalogRevision: 4,
  assignments: {
    seatSegments: { 'seat-1': 'segment-standard' },
    gaZoneSegments: { 'zone-ga': 'segment-standard' },
  },
};

describe('pricing assignment document', () => {
  it('accepts sparse stable-ID maps without copying prices', () => {
    expect(pricingAssignmentDocumentSchema.parse(document)).toEqual(document);
  });

  it('rejects empty segment references and unsupported schema versions', () => {
    expect(
      pricingAssignmentDocumentSchema.safeParse({
        ...document,
        assignments: {
          seatSegments: { 'seat-1': '' },
          gaZoneSegments: {},
        },
      }).success,
    ).toBe(false);
    expect(
      pricingAssignmentDocumentSchema.safeParse({
        ...document,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it('validates layout targets, GA kind, active segments, and matching context', () => {
    const valid = validatePricingAssignments(document, {
      occurrenceId: 'occ-1',
      layoutVersionId: 'version-1',
      snapshot,
      catalog,
    });
    expect(valid).toEqual([]);

    const invalid = validatePricingAssignments(
      {
        ...document,
        layoutVersionId: 'version-old',
        assignments: {
          seatSegments: {
            'seat-missing': 'segment-missing',
            'seat-1': 'segment-old',
          },
          gaZoneSegments: { 'zone-seated': 'segment-standard' },
        },
      },
      {
        occurrenceId: 'occ-1',
        layoutVersionId: 'version-1',
        snapshot,
        catalog,
      },
    );

    expect(invalid.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'layout_context_mismatch',
        'unknown_seat',
        'unknown_segment',
        'archived_segment',
        'not_ga_zone',
      ]),
    );
  });

  it('reports occurrence and catalog context mismatches', () => {
    const issues = validatePricingAssignments(document, {
      occurrenceId: 'occ-2',
      layoutVersionId: 'version-1',
      snapshot,
      catalog: { ...catalog, occurrenceId: 'occ-3' },
    });

    expect(issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'occurrence_context_mismatch',
        'catalog_context_mismatch',
      ]),
    );
  });
});

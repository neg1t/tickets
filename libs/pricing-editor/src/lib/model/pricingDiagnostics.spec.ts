import { describe, expect, it } from 'vitest';
import { layoutSnapshotSchema } from '@hall-platform/domain';
import type {
  PricingAssignmentDocument,
  PricingCatalog,
} from '@hall-platform/domain';
import {
  getPricingDiagnostics,
  getPricingZoneSummary,
} from './pricingDiagnostics.js';
import { createPricingTargetResolver } from './resolvePricingTargets.js';

const catalog: PricingCatalog = {
  occurrenceId: 'occ-1',
  revision: 4,
  items: [
    { id: 'standard', name: 'Standard', color: '#336699', status: 'active', price: { amountMinor: 1000, currency: 'RUB' } },
    { id: 'vip', name: 'VIP', color: '#663399', status: 'active', price: { amountMinor: 2000, currency: 'RUB' } },
    { id: 'archived', name: 'Archived', color: '#999999', status: 'archived', price: { amountMinor: 0, currency: 'RUB' } },
  ],
};

const snapshot = layoutSnapshotSchema.parse({
  id: 'snapshot-1',
  layoutVersionId: 'version-1',
  floors: [{ id: 'floor-1', layoutVersionId: 'version-1', name: 'Main' }],
  zones: [
    ...[
      ['uniform', 0],
      ['mixed', 10],
      ['partial', 20],
      ['unassigned', 30],
      ['empty', 40],
    ].map(([id, x]) => ({
      id: `zone-${id}`,
      floorId: 'floor-1',
      name: String(id),
      polygon: [
        { x: Number(x), y: 0 },
        { x: Number(x) + 4, y: 0 },
        { x: Number(x) + 4, y: 4 },
        { x: Number(x), y: 4 },
      ],
    })),
    {
      id: 'zone-ga',
      floorId: 'floor-1',
      name: 'GA',
      kind: 'ga',
      capacity: 500,
    },
  ],
  rows: [],
  seats: [
    ['u1', 'uniform', 1], ['u2', 'uniform', 2],
    ['m1', 'mixed', 11], ['m2', 'mixed', 12],
    ['p1', 'partial', 21], ['p2', 'partial', 22],
    ['n1', 'unassigned', 31], ['n2', 'unassigned', 32],
  ].map(([id, zoneId, x]) => ({
    id: `seat-${id}`,
    floorId: 'floor-1',
    zoneId: `zone-${zoneId}`,
    label: String(id),
    position: { x: Number(x), y: 1 },
    placement: { kind: 'standalone' },
  })),
  tables: [],
  backgrounds: [],
  decorations: [],
});

const document: PricingAssignmentDocument = {
  schemaVersion: 1,
  occurrenceId: 'occ-1',
  layoutVersionId: 'version-1',
  revision: 3,
  catalogRevision: 4,
  assignments: {
    seatSegments: {
      'seat-u1': 'standard',
      'seat-u2': 'standard',
      'seat-m1': 'standard',
      'seat-m2': 'vip',
      'seat-p1': 'standard',
      'seat-old': 'archived',
    },
    gaZoneSegments: { 'zone-ga': 'standard' },
  },
};

describe('pricing diagnostics', () => {
  it('summarizes uniform, mixed, partially unassigned, unassigned, and empty zones', () => {
    const resolver = createPricingTargetResolver(snapshot);
    const summaries = ['uniform', 'mixed', 'partial', 'unassigned', 'empty'].map(
      (name) =>
        getPricingZoneSummary(snapshot, document, `zone-${name}`, resolver),
    );

    expect(summaries.map(({ status }) => status)).toEqual([
      'uniform',
      'mixed',
      'partially_unassigned',
      'unassigned',
      'empty',
    ]);
    expect(summaries[1]?.segmentIds).toEqual(['standard', 'vip']);
    expect(summaries[2]?.unassignedCount).toBe(1);
  });

  it('keeps GA capacity separate from assigned ticket price and exposes invalid legacy IDs', () => {
    const resolver = createPricingTargetResolver(snapshot);
    const ga = getPricingZoneSummary(snapshot, document, 'zone-ga', resolver);
    const diagnostics = getPricingDiagnostics({ snapshot, document, catalog, resolver });

    expect(ga.kind).toBe('ga');
    expect(ga.capacity).toBe(500);
    expect(ga.segmentId).toBe('standard');
    expect(diagnostics.coverage).toEqual({
      totalSeats: 8,
      assignedSeats: 5,
      unassignedSeats: 3,
      totalGaZones: 1,
      assignedGaZones: 1,
      unassignedGaZones: 0,
    });
    expect(diagnostics.assignmentIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown_seat', targetId: 'seat-old' }),
        expect.objectContaining({ code: 'archived_segment', targetId: 'seat-old' }),
      ]),
    );
  });
});

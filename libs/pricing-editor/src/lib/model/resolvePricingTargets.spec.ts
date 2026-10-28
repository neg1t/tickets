import { describe, expect, it } from 'vitest';
import { layoutSnapshotSchema } from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import { createPricingTargetResolver } from './resolvePricingTargets.js';

const floorId = 'floor-main';

function makeSnapshot(
  overrides: Record<string, unknown> = {},
) {
  return layoutSnapshotSchema.parse({
    id: 'snapshot-1',
    layoutVersionId: 'version-1',
    floors: [
      { id: floorId, layoutVersionId: 'version-1', name: 'Main' },
      { id: 'floor-upper', layoutVersionId: 'version-1', name: 'Upper' },
    ],
    zones: [],
    rows: [],
    seats: [],
    tables: [],
    backgrounds: [],
    decorations: [],
    ...overrides,
  });
}

function zone(id: string, polygon?: { x: number; y: number }[]) {
  return {
    id,
    floorId,
    name: id,
    ...(polygon ? { polygon } : {}),
  };
}

function seat(
  id: string,
  x: number,
  y: number,
  options: {
    floorId?: string;
    zoneId?: string;
    placement?: { kind: 'standalone' } | { kind: 'row'; rowId: string } | { kind: 'table'; tableId: string };
  } = {},
) {
  return {
    id,
    floorId: options.floorId ?? floorId,
    ...(options.zoneId ? { zoneId: options.zoneId } : {}),
    label: id,
    position: { x, y },
    placement: options.placement ?? { kind: 'standalone' },
  };
}

describe('pricing target resolver', () => {
  it('uses a concave polygon and includes its boundary, independent of other floors', () => {
    const snapshot = makeSnapshot({
      zones: [
        zone('zone-l', [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 1 },
          { x: 1, y: 1 },
          { x: 1, y: 4 },
          { x: 0, y: 4 },
        ]),
      ],
      seats: [
        seat('inside-arm', 0.5, 3),
        seat('outside-notch', 3, 3),
        seat('on-boundary', 1, 3),
        seat('other-floor', 0.5, 3, { floorId: 'floor-upper' }),
      ],
    });
    const result = createPricingTargetResolver(snapshot).resolveZone('zone-l');

    expect(result.seatIds).toEqual(['inside-arm', 'on-boundary']);
    expect(result.diagnostics).toEqual([]);
  });

  it('unions zone links, row and table parent links, and geometry without duplicates', () => {
    const snapshot = makeSnapshot({
      zones: [zone('zone-seats', [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ]), zone('zone-other')],
      rows: [{
        id: 'row-a', floorId, zoneId: 'zone-seats', name: 'A',
        curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
      }],
      tables: [{
        id: 'table-a', floorId, zoneId: 'zone-seats', label: 'T',
        center: { x: 10, y: 10 }, rotationRadians: 0,
        shape: { kind: 'circle', radius: 2, seatCount: 1 },
      }],
      seats: [
        seat('linked-direct', 20, 20, { zoneId: 'zone-seats' }),
        seat('linked-row', 20, 21, { placement: { kind: 'row', rowId: 'row-a' } }),
        seat('linked-table', 20, 22, { placement: { kind: 'table', tableId: 'table-a' } }),
        seat('geometric', 1, 1),
        seat('overlap', 2, 2, { zoneId: 'zone-other' }),
      ],
    });
    const result = createPricingTargetResolver(snapshot).resolveZone('zone-seats');

    expect(result.seatIds).toEqual([
      'geometric',
      'linked-direct',
      'linked-row',
      'linked-table',
      'overlap',
    ]);
    expect(result.overlaps.map(({ seatId }) => seatId)).toEqual(['overlap']);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'linked_seat_outside_geometry',
        'different_zone_overlap',
      ]),
    );
  });

  it('uses explicit bounds only when no polygon is present and applies a fixed world tolerance', () => {
    const snapshot = makeSnapshot({
      zones: [zone('zone-bounds')],
      seats: [seat('edge', 2.0000005, 1), seat('outside', 2.00001, 1)],
    });
    const result = createPricingTargetResolver(snapshot, {
      'zone-bounds': { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    }).resolveZone('zone-bounds');

    expect(result.seatIds).toEqual(['edge']);
  });

  it('does not fall back to bounds when a polygon is invalid', () => {
    const snapshot = makeSnapshot({
      zones: [
        zone('zone-bad', [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ]),
      ],
      seats: [seat('inside-bounds', 1, 1)],
    });
    const result = createPricingTargetResolver(snapshot, {
      'zone-bad': { minX: 0, minY: 0, maxX: 3, maxY: 3 },
    }).resolveZone('zone-bad');

    expect(result.seatIds).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_zone_polygon' }),
      ]),
    );
  });

  it('blocks GA assignment when linked or geometric seats are found', () => {
    const snapshot = makeSnapshot({
      zones: [{
        ...zone('zone-ga', [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ]),
        kind: 'ga',
        capacity: 500,
      }],
      seats: [seat('inside-ga', 2, 2), seat('linked-ga', 20, 20, { zoneId: 'zone-ga' })],
    });
    const result = createPricingTargetResolver(snapshot).resolveZone('zone-ga');

    expect(result.seatIds).toEqual([]);
    expect(result.gaZoneIds).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ga_zone_contains_seats' }),
      ]),
    );
  });

  it('expands row and table selections to seat IDs and deduplicates overlapping zones', () => {
    const snapshot = makeSnapshot({
      zones: [zone('zone-a'), zone('zone-b')],
      rows: [{
        id: 'row-a', floorId, zoneId: 'zone-a', name: 'A',
        curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } },
      }],
      tables: [{
        id: 'table-a', floorId, zoneId: 'zone-a', label: 'T',
        center: { x: 10, y: 10 }, rotationRadians: 0,
        shape: { kind: 'circle', radius: 2, seatCount: 1 },
      }],
      seats: [
        seat('row-seat', 1, 1, { placement: { kind: 'row', rowId: 'row-a' } }),
        seat('table-seat', 10, 10, { placement: { kind: 'table', tableId: 'table-a' } }),
        seat('overlap-seat', 10, 10, { zoneId: 'zone-b' }),
      ],
    });
    const selected: HallTarget[] = [
      { kind: 'row', id: 'row-a' },
      { kind: 'table', id: 'table-a' },
      { kind: 'zone', id: 'zone-a' },
      { kind: 'zone', id: 'zone-b' },
    ];
    const result = createPricingTargetResolver(snapshot).resolveTargets(selected);

    expect(result.seatIds).toEqual(['overlap-seat', 'row-seat', 'table-seat']);
  });
});

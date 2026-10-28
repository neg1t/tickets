import { describe, expect, it } from 'vitest';
import { layoutSnapshotSchema } from '@hall-platform/domain';
import {
  createPerformanceAvailability,
  createPerformanceHallDraft,
  createPerformanceHallSnapshot,
  createPerformancePrices,
  getPerformanceHallId,
  PERFORMANCE_HALL_ID,
  PERFORMANCE_HALL_NAME,
  PERFORMANCE_HALL_PROFILES,
  PERFORMANCE_HALL_SIZES,
} from './index.js';

function getEntityIds(
  snapshot: ReturnType<typeof createPerformanceHallSnapshot>,
) {
  return [
    ...snapshot.floors.map(({ id }) => id),
    ...snapshot.zones.map(({ id }) => id),
    ...snapshot.rows.map(({ id }) => id),
    ...snapshot.seats.map(({ id }) => id),
    ...snapshot.tables.map(({ id }) => id),
    ...snapshot.backgrounds.map(({ id }) => id),
    ...snapshot.decorations.map(({ id }) => id),
  ];
}

describe('performance hall fixture', () => {
  it.each(PERFORMANCE_HALL_SIZES)(
    'creates deterministic unique IDs and stays within the JSON import limit at %i seats',
    (seatCount) => {
      const draft = createPerformanceHallDraft(seatCount);
      const repeated = createPerformanceHallSnapshot(seatCount);
      const ids = getEntityIds(draft.snapshot);

      expect(draft.snapshot.id).toBe(`performance-hall-${seatCount}`);
      expect(draft.snapshot.seats).toHaveLength(seatCount);
      expect(ids).toEqual(getEntityIds(repeated));
      expect(new Set(ids).size).toBe(ids.length);
      expect(
        new TextEncoder().encode(JSON.stringify(draft)).byteLength,
      ).toBeLessThanOrEqual(20 * 1024 * 1024);
    },
    120_000,
  );

  it('covers dense sectors, multiple floors, mixed geometry, and PDF assets', () => {
    const snapshot = layoutSnapshotSchema.parse(
      createPerformanceHallSnapshot(),
    );
    const draft = createPerformanceHallDraft();
    const seatCountsByZone = new Map<string, number>();
    for (const seat of snapshot.seats) {
      if (!seat.zoneId) continue;
      seatCountsByZone.set(
        seat.zoneId,
        (seatCountsByZone.get(seat.zoneId) ?? 0) + 1,
      );
    }

    expect(PERFORMANCE_HALL_NAME).toBe('Тестовый зал — 50 000 мест');
    expect(snapshot.id).toBe(PERFORMANCE_HALL_ID);
    expect(snapshot.floors).toHaveLength(3);
    expect(snapshot.zones.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...seatCountsByZone.values())).toBeGreaterThan(20_000);
    expect(snapshot.tables.length).toBeGreaterThan(0);
    expect(snapshot.decorations.some(({ kind }) => kind === 'obstacle')).toBe(
      true,
    );
    expect(
      snapshot.backgrounds.some(({ source }) => source.kind === 'pdf'),
    ).toBe(true);
    expect(
      snapshot.seats.some(({ visualKind }) => visualKind === 'wheelchairBay'),
    ).toBe(true);
    expect(
      snapshot.seats.some(
        ({ rotationRadians }) => rotationRadians !== undefined,
      ),
    ).toBe(true);
    expect(draft.assets['performance-plan-pdf']?.pages).toHaveLength(1);
  });

  it('keeps the 50k comparison fixture distributed across three floors', () => {
    const snapshot = createPerformanceHallSnapshot(50_000, 'multi-floor');

    expect(snapshot.seats).toHaveLength(50_000);
    expect(snapshot.floors).toHaveLength(3);
    expect(new Set(snapshot.seats.map(({ floorId }) => floorId)).size).toBe(3);
  }, 30_000);

  it('creates a unique 50k single-floor fixture', () => {
    const snapshot = createPerformanceHallSnapshot(50_000, 'single-floor');

    expect(snapshot.id).toBe(getPerformanceHallId(50_000, 'single-floor'));
    expect(snapshot.seats).toHaveLength(50_000);
    expect(snapshot.floors).toHaveLength(1);
    expect(new Set(snapshot.seats.map(({ floorId }) => floorId))).toEqual(
      new Set([snapshot.floors[0]?.id]),
    );
    expect(layoutSnapshotSchema.parse(snapshot).seats).toHaveLength(50_000);
  }, 30_000);

  it('creates repeated positions for dense-overlap stress scenarios', () => {
    const snapshot = createPerformanceHallSnapshot(5_000, 'dense-overlap');
    const firstRowSeats = snapshot.seats.filter(
      (seat) => seat.placement.kind === 'row' && seat.placement.rowId === 'r1',
    );
    const positions = firstRowSeats.map(
      ({ position }) => `${position.x}:${position.y}`,
    );

    expect(new Set(positions).size).toBeLessThan(positions.length);
  });

  it('uses distinct fan-shaped Bezier geometry for realistic-layout', () => {
    const baseline = createPerformanceHallSnapshot(5_000, 'multi-floor');
    const realistic = createPerformanceHallDraft(5_000, 'realistic-layout');
    const firstRow = realistic.snapshot.rows[0];
    const firstRowSeats = realistic.snapshot.seats.filter(
      ({ placement }) =>
        placement.kind === 'row' && placement.rowId === firstRow?.id,
    );

    expect(PERFORMANCE_HALL_PROFILES).toEqual([
      'multi-floor',
      'single-floor',
      'dense-overlap',
      'realistic-layout',
    ]);
    expect(realistic.snapshot.id).toBe(
      getPerformanceHallId(5_000, 'realistic-layout'),
    );
    expect(
      realistic.snapshot.rows.every(({ curve }) => curve.kind === 'bezier'),
    ).toBe(true);
    expect(realistic.snapshot.zones[0]?.polygon).not.toEqual(
      baseline.zones[0]?.polygon,
    );
    expect(
      new Set(firstRowSeats.map(({ position }) => position.y)).size,
    ).toBeGreaterThan(2);
    expect(firstRow?.curve).not.toEqual(baseline.rows[0]?.curve);
    expect(realistic.snapshot.tables.length).toBeGreaterThan(0);
    expect(realistic.snapshot.backgrounds[0]?.source.kind).toBe('pdf');
    expect(realistic.assets).toHaveProperty('performance-plan-pdf');
  });

  it('produces alternating seat statuses and price categories', () => {
    const availability = createPerformanceAvailability(5_000);
    const prices = createPerformancePrices(5_000);

    expect(new Set(Object.values(availability))).toEqual(
      new Set(['available', 'held', 'sold', 'blocked', 'unavailable']),
    );
    expect(
      new Set(Object.values(prices).map(({ category }) => category)).size,
    ).toBe(5);
  });
});

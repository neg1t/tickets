import { layoutSnapshotSchema } from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';
import {
  createPerformanceHallDraft,
  createPerformanceHallSnapshot,
  createPerformanceAvailability,
  createPerformancePrices,
  PERFORMANCE_HALL_ID,
  PERFORMANCE_HALL_NAME,
  PERFORMANCE_HALL_SIZES,
} from './performanceHall.js';

describe('performance hall fixture', () => {
  it.each(PERFORMANCE_HALL_SIZES)(
    'creates a deterministic hall with %i seats',
    (seatCount) => {
      const first = createPerformanceHallSnapshot(seatCount);
      const second = createPerformanceHallSnapshot(seatCount);

      expect(first.id).toBe(`performance-hall-${seatCount}`);
      expect(first.seats).toHaveLength(seatCount);
      expect(first.seats.map(({ id }) => id)).toEqual(
        second.seats.map(({ id }) => id),
      );
      expect(new Set(first.seats.map(({ id }) => id)).size).toBe(seatCount);
    },
  );

  it.each(PERFORMANCE_HALL_SIZES)(
    'fits the %i-seat fixture under the Studio JSON import limit',
    (seatCount) => {
      const bytes = new TextEncoder().encode(
        JSON.stringify(createPerformanceHallDraft(seatCount)),
      ).byteLength;

      expect(bytes).toBeLessThanOrEqual(20 * 1024 * 1024);
    },
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

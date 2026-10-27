import { layoutSnapshotSchema } from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';
import {
  createPerformanceHallSnapshot,
  PERFORMANCE_HALL_ID,
  PERFORMANCE_HALL_NAME,
} from './performanceHall.js';

describe('performance hall fixture', () => {
  it('creates a separate arena draft with exactly 50,000 seats', () => {
    const snapshot = layoutSnapshotSchema.parse(
      createPerformanceHallSnapshot(),
    );
    const seats = snapshot.seats;

    expect(PERFORMANCE_HALL_NAME).toBe('Тестовый зал — 50 000 мест');
    expect(snapshot.id).toBe(PERFORMANCE_HALL_ID);
    expect(snapshot.id).not.toBe('arena');
    expect(seats).toHaveLength(50_000);
    expect(new Set(seats.map(({ id }) => id)).size).toBe(50_000);
    expect(seats[0]?.position).toEqual({ x: 0, y: 0 });
    expect(seats[249]?.position).toEqual({ x: 498, y: 0 });
    expect(seats[250]?.position).toEqual({ x: 0, y: 2 });
    expect(seats.at(-1)?.position).toEqual({ x: 498, y: 398 });
  });
});

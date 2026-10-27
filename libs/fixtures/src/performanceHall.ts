import arena from './arena.json' with { type: 'json' };

export const PERFORMANCE_HALL_ID = 'performance-hall-50000';
export const PERFORMANCE_HALL_NAME = 'Тестовый зал — 50 000 мест';
export const PERFORMANCE_HALL_SEAT_COUNT = 50_000;

const columns = 250;
const layoutVersionId = 'performance-layout-50000-v1';

export function createPerformanceHallSnapshot() {
  const template = arena.document.snapshot.seats[0];
  if (!template) throw new Error('Arena fixture needs a seat template');

  return {
    ...arena.document.snapshot,
    id: PERFORMANCE_HALL_ID,
    layoutVersionId,
    floors: arena.document.snapshot.floors.map((floor) => ({
      ...floor,
      layoutVersionId,
    })),
    seats: Array.from({ length: PERFORMANCE_HALL_SEAT_COUNT }, (_, index) => ({
      ...template,
      id: `performance-seat-${index + 1}`,
      label: `${index + 1}`,
      position: {
        x: (index % columns) * 2,
        y: Math.floor(index / columns) * 2,
      },
    })),
  };
}

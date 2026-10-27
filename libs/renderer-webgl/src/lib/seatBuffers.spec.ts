import { describe, expect, it } from 'vitest';
import {
  createSeatBuffers,
  updateSeatFillColors,
  updateSeatSelection,
  updateSeatStatuses,
  type SeatBufferGeometry,
} from './seatBuffers.js';

const seats: readonly SeatBufferGeometry[] = [
  {
    id: 'seat-a',
    position: { x: 1, y: 2 },
    rotationRadians: 0.5,
    visualKind: 'chair',
  },
  {
    id: 'seat-b',
    position: { x: 4, y: 5 },
    visualKind: 'armchair',
  },
  {
    id: 'seat-c',
    position: { x: 7, y: 8 },
    visualKind: 'wheelchairBay',
  },
];

describe('WebGL seat instance buffers', () => {
  it('packs geometry once and keeps string ids outside GPU attributes', () => {
    const buffers = createSeatBuffers(seats);

    expect(buffers.ids).toEqual(['seat-a', 'seat-b', 'seat-c']);
    expect(buffers.indexById.get('seat-b')).toBe(1);
    expect([...buffers.positions]).toEqual([1, 2, 4, 5, 7, 8]);
    expect([...buffers.rotations]).toEqual([0.5, 0, 0]);
    expect([...buffers.symbolKinds]).toEqual([0, 1, 2]);
    expect([...buffers.statuses]).toEqual([0, 0, 0]);
  });

  it('coalesces adjacent status changes into partial buffer ranges', () => {
    const buffers = createSeatBuffers(seats);

    const ranges = updateSeatStatuses(buffers, [
      { id: 'seat-a', status: 'sold' },
      { id: 'seat-b', status: 'held' },
      { id: 'missing', status: 'sold' },
    ]);

    expect([...buffers.statuses]).toEqual([2, 1, 0]);
    expect(ranges).toEqual([{ start: 0, count: 2 }]);
  });

  it('packs per-seat fill colors and reports only changed instance ranges', () => {
    const buffers = createSeatBuffers(seats);

    const ranges = updateSeatFillColors(buffers, [
      { id: 'seat-b', fillColor: '#2079a8' },
    ]);

    expect([...buffers.fillColors.slice(4, 8)]).toEqual([32, 121, 168, 255]);
    expect(ranges).toEqual([{ start: 1, count: 1 }]);
  });

  it('coalesces alternating status updates to avoid one GPU call per seat', () => {
    const alternatingSeats = Array.from({ length: 100 }, (_, index) => ({
      id: `seat-${index}`,
      position: { x: index * 2, y: 0 },
    }));
    const buffers = createSeatBuffers(alternatingSeats);

    const ranges = updateSeatStatuses(
      buffers,
      alternatingSeats
        .filter((_, index) => index % 2 === 0)
        .map(({ id }) => ({ id, status: 'sold' })),
    );

    expect(ranges).toEqual([{ start: 0, count: 99 }]);
    expect(ranges.length).toBeLessThan(100);
  });

  it('changes only the selected instances', () => {
    const buffers = createSeatBuffers(seats);

    const ranges = updateSeatSelection(buffers, [
      { kind: 'seat', id: 'seat-b' },
      { kind: 'row', id: 'seat-c' },
    ]);

    expect([...buffers.selected]).toEqual([0, 1, 0]);
    expect(ranges).toEqual([{ start: 1, count: 1 }]);
  });
});

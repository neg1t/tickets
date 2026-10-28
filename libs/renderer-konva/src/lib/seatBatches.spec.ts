import { describe, expect, it } from 'vitest';
import { seatSchema, type Seat } from '@hall-platform/domain';
import { DotSeatBatcher, groupDotSeats } from './seatBatches.js';

function createSeat(
  id: string,
  x: number,
  y: number,
  visualKind: Seat['visualKind'] = 'chair',
): Seat {
  return seatSchema.parse({
    id,
    floorId: 'floor-ground',
    label: id,
    position: { x, y },
    placement: { kind: 'standalone' },
    visualKind,
  });
}

const seats = [
  createSeat('a', 0, 0),
  createSeat('b', 2, 0, 'wheelchairBay'),
  createSeat('c', 4, 0),
];

describe('far zoom seat batches', () => {
  it('keeps every dot seat in one ordered draw batch with its current appearance', () => {
    const batches = groupDotSeats(seats, 2, { b: { fill: '#f00' } }, '#fff');
    if (!batches) throw new Error('Expected dot batches');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.seats.map((seat) => seat.id)).toEqual(['a', 'b', 'c']);
    expect(batches[0]?.fills).toEqual(['#fff', '#f00', '#fff']);
    expect(
      groupDotSeats(seats, 2, { b: { fill: '#0f0' } }, '#fff')?.[0]?.fills,
    ).toEqual(['#fff', '#0f0', '#fff']);
    expect(seats[1]?.position).toEqual({ x: 2, y: 0 });
  });

  it('uses the original symbols when a visible seat is above dot detail', () => {
    expect(groupDotSeats(seats, 5, {}, '#fff')).toBeNull();
  });

  it('updates only the spatial batch whose seat appearance changed', () => {
    const batcher = new DotSeatBatcher();
    const separatedSeats = [
      createSeat('a', 0, 0),
      createSeat('b', 512, 0, 'wheelchairBay'),
      createSeat('c', 2, 0),
    ];
    const initial = batcher.build(separatedSeats, 2, {}, '#fff');
    if (!initial) throw new Error('Expected spatial dot batches');
    expect(initial.map((batch) => batch.seats.map((seat) => seat.id))).toEqual([
      ['a', 'c'],
      ['b'],
    ]);

    const updated = batcher.build(
      separatedSeats,
      2,
      { b: { fill: '#f00' } },
      '#fff',
    );
    if (!updated) throw new Error('Expected spatial dot batches');
    expect(updated[0]).toBe(initial[0]);
    expect(updated[1]).not.toBe(initial[1]);
    expect(updated[1]?.fills).toEqual(['#f00']);
  });

  it('excludes moving seats from only their affected batches', () => {
    const batcher = new DotSeatBatcher();
    const separatedSeats = [
      createSeat('moving', 0, 0),
      createSeat('stationary-nearby', 2, 0),
      createSeat('stationary-elsewhere', 512, 0),
    ];
    const initial = batcher.build(separatedSeats, 2, {}, '#fff');
    if (!initial) throw new Error('Expected spatial dot batches');

    const duringDrag = batcher.build(
      separatedSeats,
      2,
      {},
      '#fff',
      undefined,
      new Set(['moving']),
    );
    if (!duringDrag) throw new Error('Expected spatial dot batches');

    expect(
      duringDrag.map((batch) => batch.seats.map((seat) => seat.id)),
    ).toEqual([['stationary-nearby'], ['stationary-elsewhere']]);
    expect(duringDrag[0]).not.toBe(initial[0]);
    expect(duringDrag[1]).toBe(initial[1]);
  });

  it('keeps a large stationary batch when 1,000 seats move as a group', () => {
    const batcher = new DotSeatBatcher();
    const largeSeatSet = Array.from({ length: 2_000 }, (_, index) =>
      createSeat(`seat-${index}`, index * 2, 0),
    );
    const movingKeys = new Set(
      Array.from({ length: 1_000 }, (_, index) => `seat-${index}`),
    );
    const duringDrag = batcher.build(
      largeSeatSet,
      2,
      {},
      '#fff',
      undefined,
      movingKeys,
    );
    if (!duringDrag) throw new Error('Expected spatial dot batches');

    const batchedIds = duringDrag.flatMap((batch) =>
      batch.seats.map((seat) => seat.id),
    );
    expect(batchedIds).toHaveLength(1_000);
    expect(batchedIds.some((id) => movingKeys.has(id))).toBe(false);
    expect(batchedIds[0]).toBe('seat-1000');
    expect(batchedIds.at(-1)).toBe('seat-1999');
    expect(duringDrag.length).toBeLessThan(10);
  });

  it('keeps cross-block overlapping seats in source order', () => {
    const batcher = new DotSeatBatcher();
    const overlappingSeats = [
      createSeat('left', 255.9, 0),
      createSeat('far', 700, 0, 'wheelchairBay'),
      createSeat('right', 256.1, 0),
    ];
    const batches = batcher.build(overlappingSeats, 2, {}, '#fff');
    if (!batches) throw new Error('Expected spatial dot batches');

    expect(batches).toHaveLength(2);
    expect(
      batches
        .find((batch) => batch.seats.some((seat) => seat.id === 'left'))
        ?.seats.map((seat) => seat.id),
    ).toEqual(['left', 'right']);
  });

  it('returns only spatial batches intersecting the requested view', () => {
    const batcher = new DotSeatBatcher();
    const separatedSeats = [
      createSeat('a', 0, 0),
      createSeat('b', 512, 0, 'wheelchairBay'),
    ];
    const visible = batcher.build(separatedSeats, 2, {}, '#fff', {
      minX: -1,
      minY: -1,
      maxX: 1,
      maxY: 1,
    });
    if (!visible) throw new Error('Expected visible dot batches');
    expect(visible).toHaveLength(1);
    expect(visible[0]?.seats.map((seat) => seat.id)).toEqual(['a']);
  });
});

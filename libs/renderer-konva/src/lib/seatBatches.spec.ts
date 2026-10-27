import { describe, expect, it } from 'vitest';
import type { Seat } from '@hall-platform/domain';
import { DotSeatBatcher, groupDotSeats } from './seatBatches.js';

const seats = [
  { id: 'a', position: { x: 0, y: 0 }, visualKind: 'chair' },
  { id: 'b', position: { x: 2, y: 0 }, visualKind: 'wheelchairBay' },
  { id: 'c', position: { x: 4, y: 0 }, visualKind: 'chair' },
] as Seat[];

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
      { ...seats[0]!, position: { x: 0, y: 0 } },
      { ...seats[1]!, position: { x: 512, y: 0 } },
      { ...seats[2]!, position: { x: 2, y: 0 } },
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

  it('keeps cross-block overlapping seats in source order', () => {
    const batcher = new DotSeatBatcher();
    const overlappingSeats = [
      { ...seats[0]!, id: 'left', position: { x: 255.9, y: 0 } },
      { ...seats[1]!, id: 'far', position: { x: 700, y: 0 } },
      { ...seats[2]!, id: 'right', position: { x: 256.1, y: 0 } },
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
      { ...seats[0]!, position: { x: 0, y: 0 } },
      { ...seats[1]!, position: { x: 512, y: 0 } },
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

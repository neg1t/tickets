import { describe, expect, it } from 'vitest';
import type { Seat } from '@hall-platform/domain';
import { groupDotSeats } from './seatBatches.js';

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
});

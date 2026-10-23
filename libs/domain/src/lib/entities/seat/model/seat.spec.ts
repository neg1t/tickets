import { describe, expect, it } from 'vitest';
import { seatSchema } from './seat.js';

const standaloneSeat = {
  id: 'seat-1',
  floorId: 'floor-ground',
  label: '1',
  position: { x: 10, y: 20 },
  placement: { kind: 'standalone' },
};

describe('seatSchema', () => {
  it('parses a standalone seat and survives JSON serialization', () => {
    const seat = seatSchema.parse({ ...standaloneSeat, label: ' 1 ' });

    expect(seatSchema.parse(JSON.parse(JSON.stringify(seat)))).toEqual(
      standaloneSeat,
    );
  });

  it('parses a seat in a row and keeps its stable ID when moved', () => {
    const seat = seatSchema.parse({
      ...standaloneSeat,
      zoneId: 'zone-stalls',
      placement: { kind: 'row', rowId: 'row-a' },
    });

    expect(seatSchema.parse({ ...seat, position: { x: 30, y: 40 } }).id).toBe(
      'seat-1',
    );
  });

  it('parses a seat at a table', () => {
    expect(
      seatSchema.parse({
        ...standaloneSeat,
        placement: { kind: 'table', tableId: 'table-1' },
      }).placement,
    ).toEqual({ kind: 'table', tableId: 'table-1' });
  });

  it.each([
    { ...standaloneSeat, id: '' },
    { ...standaloneSeat, floorId: '' },
    { ...standaloneSeat, zoneId: '' },
    { ...standaloneSeat, label: '   ' },
    { ...standaloneSeat, position: { x: Infinity, y: 20 } },
    { ...standaloneSeat, placement: { kind: 'row' } },
    { ...standaloneSeat, placement: { kind: 'table', tableId: '' } },
    {
      ...standaloneSeat,
      placement: { kind: 'row', rowId: 'row-a', tableId: 'table-1' },
    },
  ])('rejects invalid seat data: %o', (seat) => {
    expect(seatSchema.safeParse(seat).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { inventorySchema } from './inventory.js';

const inventory = {
  occurrenceId: 'occurrence-1',
  seats: [{ seatId: 'seat-1', status: 'available' }],
  zones: [
    { zoneId: 'zone-standing', capacity: 100, held: 3, sold: 5, blocked: 2 },
  ],
};

describe('inventorySchema', () => {
  it('parses an occurrence inventory and survives JSON serialization', () => {
    const parsed = inventorySchema.parse(inventory);

    expect(inventorySchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(
      inventory,
    );
  });

  it.each(['available', 'held', 'sold', 'blocked', 'unavailable'])(
    'accepts seat status %s',
    (status) => {
      expect(
        inventorySchema.parse({
          ...inventory,
          seats: [{ seatId: 'seat-1', status }],
        }).seats[0]?.status,
      ).toBe(status);
    },
  );

  it('allows the same seat to have different statuses at different occurrences', () => {
    const first = inventorySchema.parse(inventory);
    const second = inventorySchema.parse({
      ...inventory,
      occurrenceId: 'occurrence-2',
      seats: [{ seatId: 'seat-1', status: 'sold' }],
    });

    expect(first.seats[0]?.status).toBe('available');
    expect(second.seats[0]?.status).toBe('sold');
  });

  it.each([
    { ...inventory, occurrenceId: '' },
    { ...inventory, seats: [{ seatId: '', status: 'available' }] },
    { ...inventory, seats: [{ seatId: 'seat-1', status: 'selected' }] },
    {
      ...inventory,
      seats: [{ seatId: 'seat-1', status: 'available', price: 100 }],
    },
    {
      ...inventory,
      seats: [
        { seatId: 'seat-1', status: 'available' },
        { seatId: 'seat-1', status: 'sold' },
      ],
    },
    {
      ...inventory,
      zones: [
        { zoneId: 'zone-standing', capacity: 5, held: 3, sold: 3, blocked: 0 },
      ],
    },
    {
      ...inventory,
      zones: [
        {
          zoneId: 'zone-standing',
          capacity: 10,
          held: -1,
          sold: 0,
          blocked: 0,
        },
      ],
    },
    {
      ...inventory,
      zones: [
        { zoneId: 'zone-standing', capacity: 10, held: 0, sold: 0, blocked: 0 },
        { zoneId: 'zone-standing', capacity: 10, held: 0, sold: 0, blocked: 0 },
      ],
    },
  ])('rejects invalid inventory data: %o', (input) => {
    expect(inventorySchema.safeParse(input).success).toBe(false);
  });
});

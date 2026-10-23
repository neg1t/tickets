import { test, expect } from '@playwright/test';
import { layoutDocumentSchema, inventorySchema } from '@hall-platform/domain';
import { largeHallSizes, makeLargeHallFixture } from './largeHallFixture';

for (const size of largeHallSizes) {
  test(`generates a separate ${size}-seat performance fixture`, () => {
    const fixture = makeLargeHallFixture(size);
    const seats = fixture.document.snapshot.seats;
    expect(seats).toHaveLength(size);
    expect(fixture.inventory.seats).toHaveLength(size);
    expect(new Set(seats.map(({ id }) => id)).size).toBe(size);
    expect(fixture.inventory.seats.at(-1)?.seatId).toBe(seats.at(-1)?.id);
    expect(
      layoutDocumentSchema.parse(fixture.document).snapshot.seats,
    ).toHaveLength(size);
    expect(inventorySchema.parse(fixture.inventory).seats).toHaveLength(size);
  });
}

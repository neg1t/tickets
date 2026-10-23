import arena from '@hall-platform/fixtures/arena.json';

export const largeHallSizes = [1_000, 10_000, 50_000] as const;
export type LargeHallSize = (typeof largeHallSizes)[number];

// Kept out of the four demo fixtures so normal Studio startup stays small.
export function makeLargeHallFixture(size: LargeHallSize) {
  const fixture = structuredClone(arena);
  const seat = arena.document.snapshot.seats[0];
  if (!seat) throw new Error('Arena fixture needs a seat template');
  fixture.document.snapshot.seats = Array.from(
    { length: size },
    (_, index) => ({
      ...seat,
      id: `perf-seat-${index + 1}`,
      label: `${index + 1}`,
      position: {
        x: (index % 250) * 2,
        y: Math.floor(index / 250) * 2,
      },
    }),
  );
  fixture.inventory.seats = fixture.document.snapshot.seats.map(({ id }) => ({
    seatId: id,
    status: 'available',
  }));
  return fixture;
}

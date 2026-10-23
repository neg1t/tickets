import type {
  SeatAvailabilityMap,
  SeatPriceMap,
  SeatSelectionItem,
  PublishedHallLayout,
} from '@hall-platform/seat-view';
import type { SeatStatus } from '@hall-platform/domain';

export type DemoHold = {
  id: string;
  selection: SeatSelectionItem[];
  expiresAt: number;
};

export type DemoOrder = {
  id: string;
  selection: SeatSelectionItem[];
  confirmedAt: number;
};

export type DemoOccurrence = {
  id: string;
  hallId: string;
  title: string;
  startsAt: string;
  layout: PublishedHallLayout;
  initialSeats: Record<string, SeatStatus>;
  zoneCapacity: Record<string, number>;
  prices: SeatPriceMap;
  holds: DemoHold[];
  orders: DemoOrder[];
};

export function createDemoOccurrence(
  id: string,
  layout: PublishedHallLayout,
  hallId = layout.snapshot.id,
): DemoOccurrence {
  const { snapshot } = layout;
  const statuses = [
    'available',
    'held',
    'sold',
    'blocked',
    'unavailable',
  ] as const;
  return {
    id,
    hallId,
    title: `${layout.hallName} — демо-мероприятие`,
    startsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    layout,
    initialSeats: Object.fromEntries(
      snapshot.seats.map((seat, index) => [
        seat.id,
        statuses[index % 23] ?? 'available',
      ]),
    ),
    zoneCapacity: Object.fromEntries(
      snapshot.zones
        .filter(
          (zone) =>
            zone.kind === 'ga' ||
            !snapshot.seats.some((seat) => seat.zoneId === zone.id),
        )
        .map((zone) => [zone.id, zone.capacity ?? 20]),
    ),
    prices: {
      seats: Object.fromEntries(
        snapshot.seats.map((seat) => [
          seat.id,
          {
            amount:
              1500 +
              Math.max(
                0,
                snapshot.zones.findIndex((zone) => zone.id === seat.zoneId),
              ) *
                500,
            currency: 'RUB',
            category:
              snapshot.zones.find((zone) => zone.id === seat.zoneId)?.name ??
              'Без сектора',
          },
        ]),
      ),
      zones: Object.fromEntries(
        snapshot.zones.map((zone) => [
          zone.id,
          { amount: 1000, currency: 'RUB' },
        ]),
      ),
    },
    holds: [],
    orders: [],
  };
}

export function getDemoAvailability(
  occurrence: DemoOccurrence,
  now = Date.now(),
): SeatAvailabilityMap {
  const seats = { ...occurrence.initialSeats };
  const zoneUsed: Record<string, number> = {};
  for (const selection of [
    ...occurrence.orders.map((order) => order.selection),
    ...occurrence.holds
      .filter((hold) => hold.expiresAt > now)
      .map((hold) => hold.selection),
  ]) {
    for (const item of selection) {
      if (item.kind === 'generalAdmission')
        zoneUsed[item.zoneId] = (zoneUsed[item.zoneId] ?? 0) + item.quantity;
    }
  }
  for (const order of occurrence.orders) {
    for (const item of order.selection)
      if (item.kind === 'seat') seats[item.seatId] = 'sold';
  }
  for (const hold of occurrence.holds) {
    if (hold.expiresAt <= now) continue;
    for (const item of hold.selection)
      if (item.kind === 'seat') seats[item.seatId] = 'held';
  }
  return {
    seats,
    zones: Object.fromEntries(
      Object.entries(occurrence.zoneCapacity).map(([zoneId, capacity]) => [
        zoneId,
        {
          available: Math.max(0, capacity - (zoneUsed[zoneId] ?? 0)),
          maxPerOrder: 6,
        },
      ]),
    ),
  };
}

export function getDemoTotal(
  occurrence: DemoOccurrence,
  selection: readonly SeatSelectionItem[],
): number {
  return selection.reduce((total, item) => {
    const price =
      item.kind === 'seat'
        ? occurrence.prices.seats[item.seatId]
        : occurrence.prices.zones?.[item.zoneId];
    return (
      total + (price?.amount ?? 0) * (item.kind === 'seat' ? 1 : item.quantity)
    );
  }, 0);
}

export function holdDemoSelection(
  occurrence: DemoOccurrence,
  selection: readonly SeatSelectionItem[],
  now = Date.now(),
): DemoOccurrence {
  if (selection.length === 0) throw new Error('Выберите места или билеты');
  const availability = getDemoAvailability(occurrence, now);
  const seen = new Set<string>();
  for (const item of selection) {
    const key =
      item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`;
    if (seen.has(key)) throw new Error('Повторное место в заказе');
    seen.add(key);
    if (item.kind === 'seat') {
      if (
        availability.seats[item.seatId] !== 'available' ||
        !occurrence.prices.seats[item.seatId]
      )
        throw new Error('Место больше недоступно');
    } else if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 6 ||
      item.quantity > (availability.zones?.[item.zoneId]?.available ?? 0) ||
      !occurrence.prices.zones?.[item.zoneId]
    ) {
      throw new Error('Недостаточно билетов в секторе');
    }
  }
  return {
    ...occurrence,
    holds: [
      ...occurrence.holds.filter((hold) => hold.expiresAt > now),
      {
        id: crypto.randomUUID(),
        selection: [...selection],
        expiresAt: now + 5 * 60_000,
      },
    ],
  };
}

export function cancelDemoHold(
  occurrence: DemoOccurrence,
  holdId: string,
): DemoOccurrence {
  return {
    ...occurrence,
    holds: occurrence.holds.filter((hold) => hold.id !== holdId),
  };
}

export function confirmDemoHold(
  occurrence: DemoOccurrence,
  holdId: string,
  now = Date.now(),
): DemoOccurrence {
  const hold = occurrence.holds.find((item) => item.id === holdId);
  if (!hold || hold.expiresAt <= now)
    throw new Error('Время удержания истекло. Выберите билеты заново');
  return {
    ...occurrence,
    holds: occurrence.holds.filter((item) => item.id !== holdId),
    orders: [
      ...occurrence.orders,
      { id: crypto.randomUUID(), selection: hold.selection, confirmedAt: now },
    ],
  };
}

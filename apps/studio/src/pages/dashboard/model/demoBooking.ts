import type {
  SeatAvailabilityMap,
  SeatPriceMap,
  SeatSelectionItem,
  PublishedHallLayout,
} from '@hall-platform/seat-view';
import { validateSeatPrice, validateSelection } from '@hall-platform/seat-view';
import type { SeatStatus } from '@hall-platform/domain';
import { pricingMoneySchema } from '@hall-platform/domain';
import { z } from 'zod';

export const demoPriceQuoteLineSchema = z.strictObject({
  targetKind: z.enum(['seat', 'generalAdmission']),
  targetId: z.string().min(1),
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unitAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const demoPriceQuoteSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    lines: z.array(demoPriceQuoteLineSchema).min(1),
    total: pricingMoneySchema,
  })
  .superRefine((quote, context) => {
    const currencies = new Set(quote.lines.map(({ currency }) => currency));
    const total = quote.lines.reduce(
      (amount, line) => amount + BigInt(line.unitAmountMinor) * BigInt(line.quantity),
      0n,
    );
    if (currencies.size !== 1 || !currencies.has(quote.total.currency)) {
      context.addIssue({ code: 'custom', path: ['total', 'currency'], message: 'Quote currencies must match.' });
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || Number(total) !== quote.total.amountMinor) {
      context.addIssue({ code: 'custom', path: ['total', 'amountMinor'], message: 'Quote total does not match its lines.' });
    }
    const keys = quote.lines.map(({ targetKind, targetId }) => `${targetKind}:${targetId}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', path: ['lines'], message: 'Quote lines must have unique targets.' });
    }
  });

export type DemoPriceQuote = z.infer<typeof demoPriceQuoteSchema>;

export type DemoHold = {
  id: string;
  ownerId?: string;
  selection: SeatSelectionItem[];
  quote: DemoPriceQuote;
  expiresAt: number;
};

export function findOwnActiveHold(
  occurrence: DemoOccurrence,
  ownerId: string,
  now = Date.now(),
): DemoHold | null {
  return (
    occurrence.holds.find(
      (hold) => hold.ownerId === ownerId && hold.expiresAt > now,
    ) ?? null
  );
}

export type DemoOrder = {
  id: string;
  selection: SeatSelectionItem[];
  quote: DemoPriceQuote | null;
  confirmedAt: number;
};

export type DemoOccurrence = {
  schemaVersion: 2;
  id: string;
  revision: number;
  hallId: string;
  title: string;
  startsAt: string;
  layout: PublishedHallLayout;
  initialSeats: Record<string, SeatStatus>;
  zoneCapacity: Record<string, number>;
  prices: SeatPriceMap;
  holds: DemoHold[];
  orders: DemoOrder[];
  /** Set during the one-time migration when a live legacy hold is cancelled. */
  legacyQuoteNotice?: boolean;
};

export function preferLatestDemoOccurrence(
  current: DemoOccurrence | null,
  incoming: DemoOccurrence | null,
): DemoOccurrence | null {
  if (!incoming || (current && current.id !== incoming.id)) return current;
  if (!current) return incoming;
  return (incoming.revision ?? 0) > (current.revision ?? 0)
    ? incoming
    : current;
}

export function createDemoOccurrence(
  id: string,
  layout: PublishedHallLayout,
  hallId = layout.snapshot.id,
): DemoOccurrence {
  const { snapshot } = layout;
  const buyerLayout: PublishedHallLayout = {
    hallName: layout.hallName,
    ...(layout.zoneBounds ? { zoneBounds: layout.zoneBounds } : {}),
    snapshot: {
      ...snapshot,
      backgrounds: snapshot.backgrounds.filter(
        (background) => background.source.kind !== 'pdf',
      ),
    },
  };
  const statuses = [
    'available',
    'held',
    'sold',
    'blocked',
    'unavailable',
  ] as const;
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    hallId,
    title: `${layout.hallName} — демо-мероприятие`,
    startsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    layout: buyerLayout,
    initialSeats: Object.fromEntries(
      snapshot.seats.map((seat, index) => [
        seat.id,
        statuses[index % 23] ?? 'available',
      ]),
    ),
    zoneCapacity: Object.fromEntries(
      snapshot.zones
        .filter((zone) => zone.kind === 'ga')
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
  const seen = new Set<string>();
  let currency: string | null = null;
  let fractionDigits = 0;
  let minorTotal = 0n;
  for (const item of selection) {
    if (!item || (item.kind !== 'seat' && item.kind !== 'generalAdmission'))
      throw new Error('Некорректный выбор билетов');
    const id = item.kind === 'seat' ? item.seatId : item.zoneId;
    if (typeof id !== 'string' || !id || id.trim() !== id)
      throw new Error('Некорректный выбор билетов');
    const key = `${item.kind}:${id}`;
    if (seen.has(key)) throw new Error('Повторное место в заказе');
    seen.add(key);
    const quantity = item.kind === 'seat' ? 1 : item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      throw new Error('Некорректное количество билетов');
    const price =
      item.kind === 'seat'
        ? occurrence.prices.seats[item.seatId]
        : occurrence.prices.zones?.[item.zoneId];
    const checked = validateSeatPrice(price);
    if (!checked.valid) throw new Error('Цена билета недоступна');
    if (currency !== null && checked.currency !== currency)
      throw new Error('Нельзя складывать билеты разных валют');
    currency = checked.currency;
    fractionDigits = checked.fractionDigits;
    minorTotal += BigInt(checked.minorUnits) * BigInt(quantity);
    if (minorTotal > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('Не удалось рассчитать стоимость билетов');
  }
  return Number(minorTotal) / 10 ** fractionDigits;
}

export function createDemoPriceQuote(
  occurrence: DemoOccurrence,
  selection: readonly SeatSelectionItem[],
): DemoPriceQuote {
  let currency: string | null = null;
  let totalMinor = 0n;
  const lines = selection.map((item) => {
    if (!item || (item.kind !== 'seat' && item.kind !== 'generalAdmission'))
      throw new Error('Некорректный выбор билетов');
    const targetId = item.kind === 'seat' ? item.seatId : item.zoneId;
    if (typeof targetId !== 'string' || !targetId || targetId.trim() !== targetId)
      throw new Error('Некорректный выбор билетов');
    const quantity = item.kind === 'seat' ? 1 : item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1)
      throw new Error('Некорректное количество билетов');
    const price = item.kind === 'seat'
      ? occurrence.prices.seats[item.seatId]
      : occurrence.prices.zones?.[item.zoneId];
    const checked = validateSeatPrice(price);
    if (!checked.valid) throw new Error('Цена билета недоступна');
    if (currency !== null && currency !== checked.currency)
      throw new Error('Нельзя складывать билеты разных валют');
    currency = checked.currency;
    totalMinor += BigInt(checked.minorUnits) * BigInt(quantity);
    if (totalMinor > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('Не удалось рассчитать стоимость билетов');
    return {
      targetKind: item.kind,
      targetId,
      quantity,
      unitAmountMinor: checked.minorUnits,
      currency: checked.currency,
    };
  });
  if (currency === null || lines.length === 0)
    throw new Error('Выберите места или билеты');
  return demoPriceQuoteSchema.parse({
    schemaVersion: 1,
    lines,
    total: { amountMinor: Number(totalMinor), currency },
  });
}

export function holdDemoSelection(
  occurrence: DemoOccurrence,
  selection: readonly SeatSelectionItem[],
  now = Date.now(),
  ownerId?: string,
): DemoOccurrence {
  const availability = getDemoAvailability(occurrence, now);
  const validation = validateSelection({
    layout: occurrence.layout,
    selection,
    availability,
    prices: occurrence.prices,
  });
  if (!validation.valid) {
    const code = validation.issues[0]?.code;
    if (code === 'empty_selection')
      throw new Error('Выберите места или билеты');
    if (code === 'duplicate_item') throw new Error('Повторное место в заказе');
    if (code === 'missing_price' || code === 'invalid_price')
      throw new Error('Цена билета недоступна');
    if (code === 'mixed_currencies' || code === 'total_overflow')
      throw new Error('Не удалось рассчитать стоимость билетов');
    if (code === 'unavailable_seat' || code === 'unknown_seat')
      throw new Error('Место больше недоступно');
    if (code === 'invalid_item' || code === 'invalid_id')
      throw new Error('Некорректный выбор билетов');
    throw new Error('Недостаточно билетов в секторе');
  }
  const quote = createDemoPriceQuote(occurrence, selection);
  return {
    ...occurrence,
    revision: (occurrence.revision ?? 0) + 1,
    holds: [
      ...occurrence.holds.filter((hold) => hold.expiresAt > now),
      {
        id: crypto.randomUUID(),
        ...(ownerId ? { ownerId } : {}),
        selection: [...selection],
        quote,
        expiresAt: now + 5 * 60_000,
      },
    ],
  };
}

export function cancelDemoHold(
  occurrence: DemoOccurrence,
  holdId: string,
  ownerId?: string,
): DemoOccurrence {
  const hold = occurrence.holds.find((item) => item.id === holdId);
  if (!hold) return occurrence;
  if (ownerId && hold.ownerId !== ownerId)
    throw new Error('Удержание недоступно в этой вкладке');
  return {
    ...occurrence,
    revision: (occurrence.revision ?? 0) + 1,
    holds: occurrence.holds.filter((hold) => hold.id !== holdId),
  };
}

export function confirmDemoHold(
  occurrence: DemoOccurrence,
  holdId: string,
  now = Date.now(),
  ownerId?: string,
): DemoOccurrence {
  const hold = occurrence.holds.find((item) => item.id === holdId);
  if (ownerId && hold?.ownerId !== ownerId)
    throw new Error('Удержание недоступно в этой вкладке');
  if (!hold || hold.expiresAt <= now)
    throw new Error('Время удержания истекло. Выберите билеты заново');
  return {
    ...occurrence,
    revision: (occurrence.revision ?? 0) + 1,
    holds: occurrence.holds.filter((item) => item.id !== holdId),
    orders: [
      ...occurrence.orders,
      {
        id: crypto.randomUUID(),
        selection: hold.selection,
        quote: hold.quote,
        confirmedAt: now,
      },
    ],
  };
}

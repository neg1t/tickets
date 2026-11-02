import type {
  BuyerAvailability,
  BuyerOccurrenceContext,
  BuyerOccurrenceSummary,
  BuyerPrices,
  BuyerPublicLayout,
  BuyerSelection,
} from '@hall-platform/api-contracts';
import type { PurchaseDataSource } from './purchase.types.js';
import type { SeatAvailabilityMap } from '@hall-platform/seat-view';

export type PurchaseSnapshot = Readonly<{
  context: BuyerOccurrenceContext;
  layout: BuyerPublicLayout;
  availability: BuyerAvailability;
  prices: BuyerPrices;
}>;

export type OccurrenceDateGroup = Readonly<{
  dateKey: string;
  dateLabel: string;
  occurrenceIds: readonly string[];
  items: readonly BuyerOccurrenceSummary[];
}>;

export class PurchaseSnapshotError extends Error {
  constructor(
    public readonly code: 'not_found' | 'stale_snapshot',
    message: string,
  ) {
    super(message);
    this.name = 'PurchaseSnapshotError';
  }
}

/** Fetch a coherent occurrence snapshot, rejecting any mixed IDs or revisions. */
export async function loadPurchaseSnapshot(
  dataSource: PurchaseDataSource,
  purchaseSessionId: string,
  occurrenceId: string,
  signal?: AbortSignal,
  expectedEventId?: string,
): Promise<PurchaseSnapshot> {
  const [context, layout, availability, prices] = await Promise.all([
    dataSource.getContext(purchaseSessionId, occurrenceId, signal),
    dataSource.getSeatMap(occurrenceId, signal),
    dataSource.getAvailability(occurrenceId, signal),
    dataSource.getPrices(occurrenceId, signal),
  ]);

  if (context.summary.occurrenceId !== occurrenceId ||
      availability.occurrenceId !== occurrenceId || prices.occurrenceId !== occurrenceId) {
    throw new PurchaseSnapshotError('not_found', 'The selected event time is no longer available');
  }
  if (expectedEventId && context.summary.eventId !== expectedEventId) {
    throw new PurchaseSnapshotError('not_found', 'The selected event time belongs to another event');
  }
  if (context.ownHold && context.ownHold.ownerSessionId !== purchaseSessionId) {
    throw new PurchaseSnapshotError('stale_snapshot', 'The active reservation belongs to another purchase session');
  }

  const layoutVersionId = context.layoutVersionId;
  if (layout.snapshot.layoutVersionId !== layoutVersionId ||
      availability.layoutVersionId !== layoutVersionId || prices.layoutVersionId !== layoutVersionId ||
      availability.revision !== context.availabilityRevision ||
      prices.pricingRevision !== context.pricingRevision) {
    throw new PurchaseSnapshotError('stale_snapshot', 'The seat map, availability, or prices changed. Reload to continue.');
  }
  if (prices.currency !== context.summary.currency) {
    throw new PurchaseSnapshotError('stale_snapshot', 'The event currency and ticket prices do not match');
  }
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: prices.currency });
  } catch {
    throw new PurchaseSnapshotError('stale_snapshot', 'The ticket currency is not supported');
  }

  return { context, layout, availability, prices };
}

/** Group occurrence choices by a stable local calendar date in the event timezone. */
export function groupOccurrencesByLocalDate(
  occurrences: readonly BuyerOccurrenceSummary[],
  timeZone: string,
  locale: string,
): OccurrenceDateGroup[] {
  const dateFormatter = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const labelFormatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const partsToKey = (value: string) => {
    const parts = new Map(dateFormatter.formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
    return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
  };
  const ordered = [...occurrences].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const groups = new Map<string, BuyerOccurrenceSummary[]>();

  for (const occurrence of ordered) {
    const dateKey = partsToKey(occurrence.startsAt);
    const items = groups.get(dateKey) ?? [];
    items.push(occurrence);
    groups.set(dateKey, items);
  }

  return [...groups.entries()].map(([dateKey, items]) => {
    const first = items[0];
    if (!first) throw new Error('Occurrence groups cannot be empty');
    return {
      dateKey,
      dateLabel: labelFormatter.format(new Date(first.startsAt)),
      occurrenceIds: items.map(({ occurrenceId }) => occurrenceId),
      items,
    };
  });
}

/** Exact preview arithmetic, kept in integer minor units until it reaches the UI. */
export function calculateSelectionTotalMinor(
  prices: BuyerPrices,
  selection: readonly BuyerSelection[],
): number | null {
  if (selection.length === 0) return null;
  let total = 0;
  for (const item of selection) {
    const unitPriceMinor = item.kind === 'seat'
      ? prices.seats[item.seatId]?.amountMinor
      : prices.zones[item.zoneId]?.amountMinor;
    if (unitPriceMinor === undefined) return null;
    const quantity = item.kind === 'seat' ? 1 : item.quantity;
    const lineTotal = unitPriceMinor * quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) return null;
    total += lineTotal;
  }
  return total;
}

/** Normalize optional API fields for SeatView's strict renderer-side types. */
export function mapBuyerAvailabilityToSeatView(value: BuyerAvailability): SeatAvailabilityMap {
  return {
    seats: value.seats,
    zones: Object.fromEntries(Object.entries(value.zones).map(([zoneId, zone]) => [
      zoneId,
      {
        available: zone.available,
        ...(zone.maxPerOrder === undefined ? {} : { maxPerOrder: zone.maxPerOrder }),
      },
    ])),
  };
}

import {
  apiMoneySchema,
  apiOccurrenceSchema,
  buyerPricesSchema,
  type ApiMoney,
  type ApiOccurrence,
  type BuyerPrices,
} from '@hall-platform/api-contracts';

export function minorToMajor(price: ApiMoney): number {
  const checked = apiMoneySchema.parse(price);
  const digits = new Intl.NumberFormat('en', {
    style: 'currency', currency: checked.currency,
  }).resolvedOptions().maximumFractionDigits;
  return checked.amountMinor / 10 ** (digits ?? 2);
}

function mapPrices(prices: Record<string, ApiMoney & { category?: string | undefined }>) {
  return Object.fromEntries(Object.entries(prices).map(([id, price]) => [
    id,
    {
      amount: minorToMajor({ amountMinor: price.amountMinor, currency: price.currency }),
      currency: price.currency,
      ...(price.category ? { category: price.category } : {}),
    },
  ]));
}

export function mapBuyerOccurrence(value: ApiOccurrence) {
  const occurrence = apiOccurrenceSchema.parse(value);
  return {
    id: occurrence.id,
    title: occurrence.title,
    startsAt: occurrence.startsAt,
    layoutVersionId: occurrence.layoutVersionId,
    layout: {
      hallName: occurrence.layout.hallName,
      snapshot: occurrence.layout.snapshot,
      ...(occurrence.layout.zoneBounds ? { zoneBounds: occurrence.layout.zoneBounds } : {}),
    },
    availabilityRevision: occurrence.availability.revision,
    availability: {
      seats: occurrence.availability.seats,
      zones: Object.fromEntries(Object.entries(occurrence.availability.zones).map(([id, zone]) => [
        id,
        { available: zone.available, ...(zone.maxPerOrder === undefined ? {} : { maxPerOrder: zone.maxPerOrder }) },
      ])),
    },
    prices: {
      seats: mapPrices(occurrence.prices.seats),
      zones: mapPrices(occurrence.prices.zones),
    },
    ownHold: occurrence.ownHold,
  };
}

function mapV2Prices(prices: BuyerPrices['seats'] | BuyerPrices['zones'], currency: string) {
  return Object.fromEntries(Object.entries(prices).map(([id, price]) => [
    id,
    {
      amount: minorToMajor({ amountMinor: price.amountMinor, currency }),
      currency,
      ...(price.category ? { category: price.category } : {}),
    },
  ]));
}

/** Convert server minor units only at the boundary consumed by the legacy SeatView renderer. */
export function mapV2BuyerPricesToSeatView(value: BuyerPrices) {
  const prices = buyerPricesSchema.parse(value);
  return {
    seats: mapV2Prices(prices.seats, prices.currency),
    zones: mapV2Prices(prices.zones, prices.currency),
  };
}

import { describe, expect, it, vi } from 'vitest';
import {
  buyerAvailabilitySchema,
  buyerOccurrenceContextSchema,
  buyerOccurrenceSummarySchema,
  buyerPricesSchema,
  buyerPublicLayoutSchema,
  type BuyerOccurrenceSummary,
} from '@hall-platform/api-contracts';
import { createEmptyDraft, layoutSnapshotSchema } from '@hall-platform/domain';
import type { PurchaseDataSource } from './purchase.types.js';
import {
  calculateSelectionTotalMinor,
  groupOccurrencesByLocalDate,
  loadPurchaseSnapshot,
  PurchaseSnapshotError,
} from './purchaseEffects.js';

const serverTime = '2026-10-30T12:00:00Z';

function summary(occurrenceId: string, startsAt: string): BuyerOccurrenceSummary {
  return buyerOccurrenceSummarySchema.parse({
    occurrenceId,
    eventId: 'event-1',
    title: 'Concert',
    startsAt,
    timeZone: 'Asia/Yerevan',
    venue: { name: 'Hall', city: 'Yerevan' },
    salesStatus: 'open',
    currency: 'AMD',
    capabilities: { seats: true, generalAdmission: true },
  });
}

function snapshotData(revisionMismatch = false) {
  const occurrence = summary('occ-1', serverTime);
  const context = buyerOccurrenceContextSchema.parse({
    apiVersion: 'v2',
    summary: occurrence,
    layoutVersionId: 'layout-1',
    availabilityRevision: 5,
    pricingRevision: 4,
    serverTime,
    ownHold: null,
    capabilities: { promoCode: false, emailVerification: false, paymentMode: 'none' },
  });
  const draft = createEmptyDraft('Hall');
  const layout = buyerPublicLayoutSchema.parse({
    apiVersion: 'v2',
    hallName: 'Hall',
    snapshot: layoutSnapshotSchema.parse({
      ...draft.snapshot,
      layoutVersionId: 'layout-1',
      floors: draft.snapshot.floors.map((floor) => ({ ...floor, layoutVersionId: 'layout-1' })),
    }),
  });
  const availability = buyerAvailabilitySchema.parse({
    apiVersion: 'v2',
    occurrenceId: 'occ-1',
    layoutVersionId: 'layout-1',
    revision: revisionMismatch ? 6 : 5,
    serverTime,
    seats: { seatA: 'available' },
    zones: { zoneA: { available: 10, maxPerOrder: 4 } },
  });
  const prices = buyerPricesSchema.parse({
    apiVersion: 'v2',
    occurrenceId: 'occ-1',
    layoutVersionId: 'layout-1',
    pricingRevision: 4,
    currency: 'AMD',
    seats: { seatA: { amountMinor: 1250 } },
    zones: { zoneA: { amountMinor: 4500 } },
  });
  return { occurrence, context, layout, availability, prices };
}

describe('purchase effects', () => {
  it('groups occurrences by the event timezone local date', () => {
    const first = summary('occ-before-utc-midnight', '2026-10-30T20:30:00Z');
    const second = summary('occ-after-utc-midnight', '2026-10-30T21:30:00Z');

    const groups = groupOccurrencesByLocalDate([first, second], 'Asia/Yerevan', 'ru-RU');

    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrenceIds).toEqual([
      'occ-before-utc-midnight',
      'occ-after-utc-midnight',
    ]);
  });

  it('loads only matching occurrence, layout and revision snapshots', async () => {
    const data = snapshotData();
    const source = {
      getContext: vi.fn().mockResolvedValue(data.context),
      getSeatMap: vi.fn().mockResolvedValue(data.layout),
      getAvailability: vi.fn().mockResolvedValue(data.availability),
      getPrices: vi.fn().mockResolvedValue(data.prices),
    } as unknown as PurchaseDataSource;

    const result = await loadPurchaseSnapshot(source, 'session-1', 'occ-1');

    expect(result).toMatchObject({
      context: data.context,
      layout: data.layout,
      availability: data.availability,
      prices: data.prices,
    });
    expect(source.getContext).toHaveBeenCalledWith('session-1', 'occ-1', undefined);
  });

  it('rejects a stale availability revision instead of mixing snapshots', async () => {
    const data = snapshotData(true);
    const source = {
      getContext: vi.fn().mockResolvedValue(data.context),
      getSeatMap: vi.fn().mockResolvedValue(data.layout),
      getAvailability: vi.fn().mockResolvedValue(data.availability),
      getPrices: vi.fn().mockResolvedValue(data.prices),
    } as unknown as PurchaseDataSource;

    await expect(loadPurchaseSnapshot(source, 'session-1', 'occ-1'))
      .rejects.toBeInstanceOf(PurchaseSnapshotError);
  });

  it('rejects ticket prices using a different currency from the event', async () => {
    const data = snapshotData();
    const prices = buyerPricesSchema.parse({ ...data.prices, currency: 'USD' });
    const source = {
      getContext: vi.fn().mockResolvedValue(data.context),
      getSeatMap: vi.fn().mockResolvedValue(data.layout),
      getAvailability: vi.fn().mockResolvedValue(data.availability),
      getPrices: vi.fn().mockResolvedValue(prices),
    } as unknown as PurchaseDataSource;

    await expect(loadPurchaseSnapshot(source, 'session-1', 'occ-1'))
      .rejects.toMatchObject({ code: 'stale_snapshot' });
  });

  it('calculates preview totals in safe integer minor units for seats and GA', () => {
    const { prices } = snapshotData();

    expect(calculateSelectionTotalMinor(prices, [
      { kind: 'seat', seatId: 'seatA' },
      { kind: 'generalAdmission', zoneId: 'zoneA', quantity: 2 },
    ])).toBe(10_250);
    expect(calculateSelectionTotalMinor(prices, [
      { kind: 'seat', seatId: 'missing-seat' },
    ])).toBeNull();
  });
});

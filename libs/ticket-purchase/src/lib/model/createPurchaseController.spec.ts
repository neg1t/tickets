import { describe, expect, it, vi } from 'vitest';
import {
  buyerAvailabilitySchema,
  buyerHoldSchema,
  buyerOccurrenceContextSchema,
  buyerOccurrenceListSchema,
  buyerOccurrenceSummarySchema,
  buyerPricesSchema,
  buyerPublicLayoutSchema,
  type BuyerHold,
  type BuyerOccurrenceSummary,
} from '@hall-platform/api-contracts';
import { BuyerApiError } from '@hall-platform/api-axios';
import { createEmptyDraft, layoutSnapshotSchema } from '@hall-platform/domain';
import type { SeatSelectionItem } from '@hall-platform/seat-view';
import type { PurchaseDataSource } from './purchase.types.js';
import { createPurchaseController } from './createPurchaseController.js';

const serverTime = '2026-10-30T12:00:00Z';

function summary(occurrenceId: string): BuyerOccurrenceSummary {
  return buyerOccurrenceSummarySchema.parse({
    occurrenceId,
    eventId: 'event-1',
    title: `Concert ${occurrenceId}`,
    startsAt: occurrenceId === 'occ-1' ? '2026-10-30T16:00:00+04:00' : '2026-10-31T16:00:00+04:00',
    timeZone: 'Asia/Yerevan',
    venue: { name: 'Hall', city: 'Yerevan' },
    salesStatus: 'open',
    currency: 'AMD',
    capabilities: { seats: true, generalAdmission: true },
  });
}

const draft = createEmptyDraft('Hall');
const floorId = draft.snapshot.floors[0]?.id;
if (!floorId) throw new Error('Expected the draft layout to contain a floor');
const publicLayout = buyerPublicLayoutSchema.parse({
  apiVersion: 'v2',
  hallName: 'Hall',
  snapshot: layoutSnapshotSchema.parse({
    ...draft.snapshot,
    layoutVersionId: 'layout-1',
    floors: draft.snapshot.floors.map((floor) => ({ ...floor, layoutVersionId: 'layout-1' })),
    zones: [{ id: 'zone-a', floorId, name: 'Parterre', kind: 'ga', capacity: 100 }],
    seats: [{ id: 'seat-a', floorId, label: 'A-1', position: { x: 0, y: 0 }, placement: { kind: 'standalone' } }],
  }),
});

function makeSource(options: { serverTotalMinor?: number; holdCurrency?: string; createHoldError?: Error } = {}) {
  const occurrences = [summary('occ-1'), summary('occ-2')];
  const currentHold: { value: BuyerHold | null } = { value: null };
  const dataSource = {
    createSession: vi.fn(async ({ occurrenceId }: { occurrenceId: string }, _key: string, _signal?: AbortSignal) => ({
      apiVersion: 'v2' as const,
      purchaseSessionId: `session-${occurrenceId}`,
      sessionCredential: `secret-${occurrenceId}`,
      expiresAt: '2026-10-31T12:00:00Z',
    })),
    listOccurrences: vi.fn(async () => buyerOccurrenceListSchema.parse({
      apiVersion: 'v2', items: occurrences, pagination: { nextCursor: null, hasMore: false },
    })),
    getContext: vi.fn(async (purchaseSessionId: string, occurrenceId: string) =>
      buyerOccurrenceContextSchema.parse({
        apiVersion: 'v2', summary: summary(occurrenceId), layoutVersionId: 'layout-1',
        availabilityRevision: 1, pricingRevision: 1, serverTime,
        ownHold: currentHold.value?.ownerSessionId === purchaseSessionId ? currentHold.value : null,
        capabilities: { promoCode: false, emailVerification: false, paymentMode: 'none' },
      })),
    getSeatMap: vi.fn(async () => publicLayout),
    getAvailability: vi.fn(async (occurrenceId: string) => buyerAvailabilitySchema.parse({
      apiVersion: 'v2', occurrenceId, layoutVersionId: 'layout-1', revision: 1, serverTime,
      seats: { 'seat-a': 'available' }, zones: { 'zone-a': { available: 100, maxPerOrder: 8 } },
    })),
    getPrices: vi.fn(async (occurrenceId: string) => buyerPricesSchema.parse({
      apiVersion: 'v2', occurrenceId, layoutVersionId: 'layout-1', pricingRevision: 1,
      currency: 'AMD', seats: { 'seat-a': { amountMinor: 10_000 } }, zones: { 'zone-a': { amountMinor: 4_500 } },
    })),
    createHold: vi.fn(async (purchaseSessionId: string, occurrenceId: string, request: { selection: SeatSelectionItem[] }) => {
      if (options.createHoldError) throw options.createHoldError;
      const selectionItem = request.selection[0];
      const quantity = selectionItem?.kind === 'generalAdmission' ? selectionItem.quantity : 1;
      const defaultUnitPriceMinor = selectionItem?.kind === 'seat' ? 10_000 : 4_500;
      const totalMinor = options.serverTotalMinor ?? defaultUnitPriceMinor * quantity;
      const unitPriceMinor = totalMinor / quantity;
      const result = buyerHoldSchema.parse({
        apiVersion: 'v2', id: 'hold-1', ownerSessionId: purchaseSessionId, occurrenceId,
        layoutVersionId: 'layout-1', revision: 1, expiresAt: '2026-10-30T12:15:00Z', serverTime,
        selection: request.selection,
        lineItems: [{ label: selectionItem?.kind === 'generalAdmission' ? 'Parterre' : 'A-1', quantity, unitPriceMinor, totalMinor }],
        totalMinor, currency: options.holdCurrency ?? 'AMD', availabilityRevision: 2, status: 'active',
      });
      currentHold.value = result;
      return result;
    }),
    getHold: vi.fn(async () => {
      if (!currentHold.value) throw new BuyerApiError('not_found', 'Hold not found');
      return currentHold.value;
    }),
    cancelHold: vi.fn(async () => {
      currentHold.value = currentHold.value
        ? buyerHoldSchema.parse({ ...currentHold.value, revision: currentHold.value.revision + 1, status: 'cancelled' })
        : null;
    }),
  };
  return { source: dataSource as unknown as PurchaseDataSource, dataSource, currentHold };
}

describe('createPurchaseController', () => {
  it('creates a per-widget session and loads matching data without exposing its credential', async () => {
    const { source, dataSource } = makeSource();
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-1` });

    await controller.start('event-1', 'occ-1');

    expect(controller.getSnapshot().status).toBe('ready');
    expect(controller.getSnapshot().purchaseSessionId).toBe('session-occ-1');
    expect(controller.getSnapshot()).not.toHaveProperty('sessionCredential');
    expect(dataSource.createSession).toHaveBeenCalledWith({ occurrenceId: 'occ-1' }, 'session-1', expect.any(AbortSignal));
  });

  it('reuses the created session after a transient context request failure', async () => {
    const { source, dataSource } = makeSource();
    dataSource.getContext.mockRejectedValueOnce(new BuyerApiError('network_error', 'Offline'));
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-retry` });

    await controller.start('event-1', 'occ-1');
    expect(controller.getSnapshot().status).toBe('error');
    await controller.retry();

    expect(controller.getSnapshot().status).toBe('ready');
    expect(dataSource.createSession).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('retries session creation with the same idempotency key after a transient create failure', async () => {
    const { source, dataSource } = makeSource();
    dataSource.createSession.mockRejectedValueOnce(new BuyerApiError('network_error', 'Offline'));
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-retry` });

    await controller.start('event-1', 'occ-1');
    expect(controller.getSnapshot().status).toBe('error');
    await controller.retry();

    expect(controller.getSnapshot().status).toBe('ready');
    expect(dataSource.createSession).toHaveBeenCalledTimes(2);
    expect(dataSource.createSession.mock.calls[0]?.[1]).toBe('session-retry');
    expect(dataSource.createSession.mock.calls[1]?.[1]).toBe('session-retry');
    controller.dispose();
  });

  it('posts only the selected seat with all current revisions and ignores duplicate Continue clicks', async () => {
    const { source, dataSource } = makeSource();
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-1` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);

    const results = await Promise.all([controller.continue(), controller.continue()]);

    expect(dataSource.createHold).toHaveBeenCalledTimes(1);
    expect(dataSource.createHold).toHaveBeenCalledWith(
      'session-occ-1',
      'occ-1',
      {
        apiVersion: 'v2', layoutVersionId: 'layout-1', availabilityRevision: 1,
        pricingRevision: 1, selection: [{ kind: 'seat', seatId: 'seat-a' }],
      },
      'hold-1',
      expect.any(AbortSignal),
    );
    expect(results[0]?.kind).toBe('reserved');
    expect(results[1]).toEqual(results[0]);
  });

  it('reserves general admission quantities without creating seat or row labels', async () => {
    const { source, dataSource } = makeSource();
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-ga` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'generalAdmission', zoneId: 'zone-a', quantity: 2 }]);

    const result = await controller.continue();

    expect(dataSource.createHold).toHaveBeenCalledWith(
      'session-occ-1',
      'occ-1',
      {
        apiVersion: 'v2', layoutVersionId: 'layout-1', availabilityRevision: 1,
        pricingRevision: 1, selection: [{ kind: 'generalAdmission', zoneId: 'zone-a', quantity: 2 }],
      },
      'hold-ga',
      expect.any(AbortSignal),
    );
    expect(result.kind).toBe('reserved');
    expect(controller.getSnapshot().hold?.lineItems[0]?.label).toBe('Parterre');
    controller.dispose();
  });

  it('locks selection and retries an uncertain hold with the exact same body and idempotency key', async () => {
    const { source, dataSource } = makeSource();
    dataSource.createHold.mockRejectedValueOnce(new BuyerApiError('network_error', 'Connection lost'));
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-uncertain` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);

    expect((await controller.continue()).kind).toBe('error');
    expect(controller.getSnapshot().status).toBe('hold_retry_required');
    controller.setSelection([{ kind: 'generalAdmission', zoneId: 'zone-a', quantity: 1 }]);
    expect(controller.getSnapshot().selection).toEqual([{ kind: 'seat', seatId: 'seat-a' }]);

    expect((await controller.continue()).kind).toBe('reserved');
    const firstRequest = dataSource.createHold.mock.calls[0];
    const retryRequest = dataSource.createHold.mock.calls[1];
    expect(retryRequest?.slice(0, 4)).toEqual(firstRequest?.slice(0, 4));
    controller.dispose();
  });

  it('blocks general admission quantities above maxPerOrder with an explanation', async () => {
    const { source, dataSource } = makeSource();
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-limit` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'generalAdmission', zoneId: 'zone-a', quantity: 9 }]);

    const result = await controller.continue();

    expect(result).toMatchObject({ kind: 'invalid_selection' });
    expect(result.kind === 'invalid_selection' ? result.message : '').toMatch(/quantity|limit|price|availability/i);
    expect(dataSource.createHold).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('requires explicit confirmation when the server hold total differs from the preview', async () => {
    const { source } = makeSource({ serverTotalMinor: 12_000 });
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-1` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);

    const result = await controller.continue();

    expect(result.kind).toBe('price_confirmation');
    expect(controller.getSnapshot().status).toBe('price_confirmation_required');
    expect(controller.getSnapshot().serverTotalMinor).toBe(12_000);
    expect((await Promise.resolve(controller.confirmServerTotal())).kind).toBe('reserved');
  });

  it('blocks and releases a hold whose currency does not match the selected tickets', async () => {
    const { source, dataSource } = makeSource({ holdCurrency: 'USD' });
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-currency` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);

    expect((await controller.continue()).kind).toBe('error');
    expect(controller.getSnapshot().status).toBe('error');
    expect(controller.getSnapshot().hold).toBeNull();
    expect(controller.getSnapshot().errorCode).toBe('currency_mismatch');
    expect(dataSource.cancelHold).toHaveBeenCalledTimes(1);
    await controller.retry();
    expect(controller.getSnapshot().status).toBe('ready');
    controller.dispose();
  });

  it('requires confirmation of refreshed prices before creating a hold after a stale-price response', async () => {
    const { source, dataSource } = makeSource({ createHoldError: new BuyerApiError('price_changed', 'Price changed', 2) });
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-1` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);

    const result = await controller.continue();

    expect(result.kind).toBe('price_confirmation');
    expect(dataSource.createHold).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().prices?.pricingRevision).toBe(1);
    expect(controller.getSnapshot().status).toBe('price_confirmation_required');
  });

  it('requires an explicit reset before switching occurrence while a hold is active', async () => {
    const { source, dataSource } = makeSource();
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-1` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);
    await controller.continue();

    await controller.selectOccurrence('occ-2');

    expect(controller.getSnapshot().status).toBe('confirm_occurrence_change');
    expect(dataSource.cancelHold).not.toHaveBeenCalled();
    controller.cancelOccurrenceChange();
    expect(controller.getSnapshot().status).toBe('reserved');
    expect((await controller.continue()).kind).toBe('reserved');
    expect(dataSource.createHold).toHaveBeenCalledTimes(1);

    await controller.selectOccurrence('occ-2');
    await controller.confirmOccurrenceChange();
    expect(dataSource.cancelHold).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().occurrence?.occurrenceId).toBe('occ-2');
    expect(controller.getSnapshot().selection).toEqual([]);
  });

  it('requires hold reconciliation when the occurrence prop changes during an active hold', async () => {
    const { source, dataSource } = makeSource();
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-prop` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);
    await controller.continue();

    await controller.start('event-1', 'occ-2');

    expect(controller.getSnapshot().status).toBe('confirm_occurrence_change');
    expect(dataSource.cancelHold).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pendingOccurrenceId).toBe('occ-2');
    await controller.confirmOccurrenceChange();
    expect(dataSource.cancelHold).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().occurrence?.occurrenceId).toBe('occ-2');
    controller.dispose();
  });

  it('keeps an active buyer hold available when the occurrence becomes sold out', async () => {
    const { source, dataSource } = makeSource();
    const originalGetContext = dataSource.getContext.getMockImplementation();
    if (!originalGetContext) throw new Error('Expected the source context implementation');
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-soldout` });
    await controller.start('event-1', 'occ-1');
    controller.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);
    await controller.continue();
    dataSource.getContext.mockImplementation(async (...args) => {
      const context = await originalGetContext(...args);
      return buyerOccurrenceContextSchema.parse({
        ...context,
        summary: { ...context.summary, salesStatus: 'sold_out' },
      });
    });

    await controller.start('event-1', 'occ-1');

    expect(controller.getSnapshot().status).toBe('reserved');
    expect(controller.getSnapshot().hold?.status).toBe('active');
    controller.dispose();
  });

  it('refreshes inventory after another session wins the same seat', async () => {
    const { source, dataSource } = makeSource();
    let allocated = false;
    let refreshAsHeld = false;
    let sessionSequence = 0;
    const createHold = dataSource.createHold.getMockImplementation();
    dataSource.createSession.mockImplementation(async ({ occurrenceId }) => ({
      apiVersion: 'v2',
      purchaseSessionId: `session-${occurrenceId}-${++sessionSequence}`,
      sessionCredential: `secret-${sessionSequence}`,
      expiresAt: '2026-10-31T12:00:00Z',
    }));
    dataSource.createHold.mockImplementation(async (...args) => {
      if (allocated) {
        refreshAsHeld = true;
        throw new BuyerApiError('availability_conflict', 'Seat was taken');
      }
      allocated = true;
      if (!createHold) throw new Error('Expected the source hold implementation');
      return createHold(...args);
    });
    dataSource.getAvailability.mockImplementation(async (occurrenceId) => buyerAvailabilitySchema.parse({
      apiVersion: 'v2', occurrenceId, layoutVersionId: 'layout-1', revision: 1, serverTime,
      seats: { 'seat-a': refreshAsHeld ? 'held' : 'available' },
      zones: { 'zone-a': { available: 100, maxPerOrder: 8 } },
    }));

    const first = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-first` });
    const second = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-second` });
    await Promise.all([first.start('event-1', 'occ-1'), second.start('event-1', 'occ-1')]);
    first.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);
    second.setSelection([{ kind: 'seat', seatId: 'seat-a' }]);

    expect((await first.continue()).kind).toBe('reserved');
    expect((await second.continue()).kind).toBe('unavailable');
    expect(second.getSnapshot().unavailableSelection).toEqual(['seat:seat-a']);
    expect(second.getSnapshot().availability?.seats['seat-a']).toBe('held');
    first.dispose();
    second.dispose();
  });

  it('ignores a stale response from an occurrence that has already been replaced', async () => {
    const { source, dataSource } = makeSource();
    const originalGetContext = dataSource.getContext.getMockImplementation();
    if (!originalGetContext) throw new Error('Expected the source context implementation');
    let releaseOldContext: (() => void) | undefined;
    let markOldContextStarted: (() => void) | undefined;
    const oldContextStarted = new Promise<void>((resolve) => { markOldContextStarted = resolve; });
    const oldContextGate = new Promise<void>((resolve) => { releaseOldContext = resolve; });
    dataSource.getContext.mockImplementation(async (...args) => {
      if (args[1] === 'occ-1') {
        markOldContextStarted?.();
        await oldContextGate;
      }
      return originalGetContext(...args);
    });
    const controller = createPurchaseController(source, { idempotencyKey: (operation) => `${operation}-1` });

    const staleStart = controller.start('event-1', 'occ-1');
    await oldContextStarted;
    await controller.start('event-1', 'occ-2');
    expect(controller.getSnapshot().occurrence?.occurrenceId).toBe('occ-2');
    releaseOldContext?.();
    await staleStart;

    expect(controller.getSnapshot().occurrence?.occurrenceId).toBe('occ-2');
    controller.dispose();
  });
});

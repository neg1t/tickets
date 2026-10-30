import { describe, expect, it } from 'vitest';
import { createEmptyDraft, seatSchema, zoneSchema } from '@hall-platform/domain';
import { parseHallLayoutDraft } from '@hall-platform/hall-editor';
import { createDemoOccurrence } from './demoBooking.js';
import { reconcileOccurrenceLayout } from './reconcileOccurrenceInventory.js';

function firstFloor(draft: ReturnType<typeof createEmptyDraft>) {
  const floor = draft.snapshot.floors[0];
  if (!floor) throw new Error('Expected the default floor');
  return floor;
}

describe('reconcileOccurrenceLayout', () => {
  it('keeps surviving seat status and prices while initializing added seats', () => {
    const draft = createEmptyDraft('Hall');
    const floor = firstFloor(draft);
    const originalSeat = seatSchema.parse({ id: 'seat-old', floorId: floor.id, position: { x: 0, y: 0 }, type: 'chair', label: '1', placement: { kind: 'standalone' } });
    const baseOccurrence = createDemoOccurrence('show-1', { hallName: 'Hall', snapshot: { ...draft.snapshot, seats: [originalSeat] } });
    const occurrence = { ...baseOccurrence, initialSeats: { ...baseOccurrence.initialSeats, 'seat-old': 'blocked' as const }, prices: { ...baseOccurrence.prices, seats: { ...baseOccurrence.prices.seats, 'seat-old': { amount: 500, currency: 'RUB' } } } };
    const nextDraft = parseHallLayoutDraft({ ...draft, snapshot: { ...draft.snapshot, seats: [originalSeat, { ...originalSeat, id: 'seat-new', label: '2' }] } });

    const result = reconcileOccurrenceLayout(occurrence, nextDraft);

    expect(result.conflicts).toEqual([]);
    expect(result.occurrence.initialSeats).toEqual({ 'seat-old': 'blocked', 'seat-new': 'available' });
    expect(result.occurrence.prices.seats).toEqual({ 'seat-old': { amount: 500, currency: 'RUB' } });
    expect(result.occurrence.layout.snapshot.backgrounds).toEqual([]);
    expect(result.occurrence.layout.snapshot.layoutVersionId).not.toBe(occurrence.layout.snapshot.layoutVersionId);
  });

  it('rejects deleting a seat referenced by an order', () => {
    const draft = createEmptyDraft('Hall');
    const floor = firstFloor(draft);
    const seat = seatSchema.parse({ id: 'seat-sold', floorId: floor.id, position: { x: 0, y: 0 }, type: 'chair', label: '1', placement: { kind: 'standalone' } });
    const baseOccurrence = createDemoOccurrence('show-1', { hallName: 'Hall', snapshot: { ...draft.snapshot, seats: [seat] } });
    const occurrence = { ...baseOccurrence, orders: [{ id: 'order-1', selection: [{ kind: 'seat' as const, seatId: 'seat-sold' }], quote: null, confirmedAt: Date.now() }] };

    const result = reconcileOccurrenceLayout(occurrence, draft);

    expect(result.conflicts.map(({ code, targetId }) => [code, targetId])).toContainEqual(['removed_committed_seat', 'seat-sold']);
  });

  it('protects blocked seats and ignores expired holds', () => {
    const draft = createEmptyDraft('Hall');
    const floor = firstFloor(draft);
    const blocked = seatSchema.parse({ id: 'seat-blocked', floorId: floor.id, position: { x: 0, y: 0 }, type: 'chair', label: '1', placement: { kind: 'standalone' } });
    const free = seatSchema.parse({ id: 'seat-expired-hold', floorId: floor.id, position: { x: 10, y: 0 }, type: 'chair', label: '2', placement: { kind: 'standalone' } });
    const base = createDemoOccurrence('show-1', { hallName: 'Hall', snapshot: { ...draft.snapshot, seats: [blocked, free] } });
    const occurrence = {
      ...base,
      initialSeats: {
        ...base.initialSeats,
        'seat-blocked': 'blocked' as const,
        'seat-expired-hold': 'available' as const,
      },
      holds: [{
        id: 'expired-hold',
        selection: [{ kind: 'seat' as const, seatId: 'seat-expired-hold' }],
        quote: { schemaVersion: 1 as const, lines: [{ targetKind: 'seat' as const, targetId: 'seat-expired-hold', quantity: 1, unitAmountMinor: 1, currency: 'RUB' }], total: { amountMinor: 1, currency: 'RUB' } },
        expiresAt: 10,
      }],
    };
    const noSeats = parseHallLayoutDraft({ ...draft, snapshot: { ...draft.snapshot, seats: [] } });

    const result = reconcileOccurrenceLayout(occurrence, noSeats, 20);

    expect(result.conflicts.map(({ targetId }) => targetId)).toEqual(['seat-blocked']);
  });

  it('rejects GA capacity below the quantity already sold', () => {
    const draft = createEmptyDraft('Hall');
    const floor = firstFloor(draft);
    const zone = zoneSchema.parse({ id: 'zone-ga', floorId: floor.id, name: 'Балкон', kind: 'ga', capacity: 10 });
    const base = createDemoOccurrence('show-1', { hallName: 'Hall', snapshot: { ...draft.snapshot, zones: [zone] } });
    const occurrence = {
      ...base,
      orders: [{
        id: 'order-ga',
        selection: [{ kind: 'generalAdmission' as const, zoneId: zone.id, quantity: 6 }],
        quote: null,
        confirmedAt: 1,
      }],
    };
    const smallerZone = { ...zone, capacity: 5 };
    const nextDraft = parseHallLayoutDraft({ ...draft, snapshot: { ...draft.snapshot, zones: [smallerZone] } });

    const result = reconcileOccurrenceLayout(occurrence, nextDraft);

    expect(result.conflicts.map(({ targetId }) => targetId)).toContain(zone.id);
  });
});

import { describe, expect, it } from 'vitest';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import banquetHall from '@hall-platform/fixtures/banquet-hall.json';
import {
  backgroundSchema,
  layoutDocumentSchema,
  layoutSnapshotSchema,
  worldPointSchema,
} from '@hall-platform/domain';
import {
  createDemoOccurrence,
  getDemoAvailability,
  holdDemoSelection,
  confirmDemoHold,
  cancelDemoHold,
  getDemoTotal,
  findOwnActiveHold,
  preferLatestDemoOccurrence,
} from './demoBooking.js';

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
const layout = { hallName: 'Small Theater', snapshot };
const seatId = snapshot.seats[0]?.id ?? '';

describe('demo booking', () => {
  it('omits private PDF assets and backgrounds from buyer payload', () => {
    const background = backgroundSchema.parse({
      id: 'private-pdf',
      floorId: snapshot.floors[0]?.id,
      order: 0,
      position: worldPointSchema.parse({ x: 0, y: 0 }),
      scale: 1,
      rotationRadians: 0,
      opacity: 1,
      visible: true,
      locked: false,
      source: { kind: 'pdf', assetId: 'private-plan', pageNumber: 1 },
    });
    const privateLayout = {
      ...layout,
      snapshot: { ...snapshot, backgrounds: [background] },
      assets: {
        'private-plan': { dataUrl: 'data:application/pdf;base64,SECRET' },
      },
    };
    const occurrence = createDemoOccurrence('private', privateLayout);
    expect('assets' in occurrence.layout).toBe(false);
    expect(occurrence.layout.snapshot.backgrounds).toEqual([]);
    expect(JSON.stringify(occurrence)).not.toContain('SECRET');
  });

  it('holds a seat, rejects a competing hold, then confirms it as sold', () => {
    const occurrence = createDemoOccurrence('demo-small', layout);
    const held = holdDemoSelection(
      occurrence,
      [{ kind: 'seat', seatId }],
      1000,
    );
    expect(getDemoAvailability(held, 1000).seats[seatId]).toBe('held');
    expect(() =>
      holdDemoSelection(held, [{ kind: 'seat', seatId }], 1001),
    ).toThrow();
    const sold = confirmDemoHold(held, held.holds[0]?.id ?? '', 1002);
    expect(getDemoAvailability(sold, 1002).seats[seatId]).toBe('sold');
    expect(getDemoTotal(sold, sold.orders[0]?.selection ?? [])).toBe(1500);
  });

  it('keeps a hold quote immutable through pricing changes and copies it to the order', () => {
    const initial = createDemoOccurrence('demo-small', layout);
    const held = holdDemoSelection(
      initial,
      [{ kind: 'seat', seatId }],
      1000,
    );
    const originalQuote = held.holds[0]?.quote;
    const repriced = {
      ...held,
      prices: {
        ...held.prices,
        seats: { ...held.prices.seats, [seatId]: { amount: 9999, currency: 'RUB' } },
      },
    };
    const confirmed = confirmDemoHold(repriced, held.holds[0]?.id ?? '', 1002);

    expect(originalQuote?.total).toEqual({ amountMinor: 150000, currency: 'RUB' });
    expect(confirmed.orders[0]?.quote).toEqual(originalQuote);
    expect(confirmed.orders[0]?.quote?.total.amountMinor).toBe(150000);
  });

  it('releases an expired or cancelled hold', () => {
    const occurrence = createDemoOccurrence('demo-small', layout);
    const held = holdDemoSelection(
      occurrence,
      [{ kind: 'seat', seatId }],
      1000,
    );
    expect(getDemoAvailability(held, 1000 + 5 * 60_000).seats[seatId]).toBe(
      'available',
    );
    const cancelled = cancelDemoHold(held, held.holds[0]?.id ?? '');
    expect(getDemoAvailability(cancelled, 1001).seats[seatId]).toBe(
      'available',
    );
  });

  it('restores only the current owner active hold', () => {
    const occurrence = createDemoOccurrence('demo-small', layout);
    const held = holdDemoSelection(
      occurrence,
      [{ kind: 'seat', seatId }],
      1000,
      'tab-a',
    );
    const holdId = held.holds[0]?.id;
    expect(findOwnActiveHold(held, 'tab-a', 1001)?.id).toBe(holdId);
    expect(findOwnActiveHold(held, 'tab-b', 1001)).toBeNull();
    expect(findOwnActiveHold(held, 'tab-a', 1000 + 5 * 60_000)).toBeNull();
  });

  it('does not let another owner confirm or cancel a hold', () => {
    const held = holdDemoSelection(
      createDemoOccurrence('demo-small', layout),
      [{ kind: 'seat', seatId }],
      1000,
      'tab-a',
    );
    const holdId = held.holds[0]?.id ?? '';
    expect(() => confirmDemoHold(held, holdId, 1001, 'tab-b')).toThrow(
      'недоступно',
    );
    expect(() => cancelDemoHold(held, holdId, 'tab-b')).toThrow('недоступно');
  });

  it('treats a repeated cancel as a no-op after a hold is gone', () => {
    const initial = createDemoOccurrence('demo-small', layout);
    const held = holdDemoSelection(
      initial,
      [{ kind: 'seat', seatId }],
      1000,
      'tab-a',
    );
    const cancelled = cancelDemoHold(held, held.holds[0]?.id ?? '', 'tab-a');
    expect(cancelDemoHold(cancelled, held.holds[0]?.id ?? '', 'tab-a')).toBe(
      cancelled,
    );
  });

  it('rejects missing or malformed prices before creating a hold', () => {
    const occurrence = createDemoOccurrence('demo-small', layout);
    const selection = [{ kind: 'seat' as const, seatId }];
    const withoutPrice = {
      ...occurrence,
      prices: {
        ...occurrence.prices,
        seats: Object.fromEntries(
          Object.entries(occurrence.prices.seats).filter(
            ([id]) => id !== seatId,
          ),
        ),
      },
    };
    expect(() => holdDemoSelection(withoutPrice, selection, 1000)).toThrow(
      'Цена',
    );
    const malformed = {
      ...occurrence,
      prices: {
        ...occurrence.prices,
        seats: {
          ...occurrence.prices.seats,
          [seatId]: { amount: Number.NaN, currency: 'RUB' },
        },
      },
    };
    expect(() => holdDemoSelection(malformed, selection, 1000)).toThrow('Цена');
  });

  it('totals fractional RUB prices exactly in minor units', () => {
    const occurrence = createDemoOccurrence('demo-small', layout);
    const nextSeatId = snapshot.seats[1]?.id ?? '';
    const priced = {
      ...occurrence,
      prices: {
        ...occurrence.prices,
        seats: {
          ...occurrence.prices.seats,
          [seatId]: { amount: 0.1, currency: 'RUB' },
          [nextSeatId]: { amount: 0.2, currency: 'RUB' },
        },
      },
    };
    expect(
      getDemoTotal(priced, [
        { kind: 'seat', seatId },
        { kind: 'seat', seatId: nextSeatId },
      ]),
    ).toBe(0.3);
  });

  it('rejects mixed currencies, duplicate tickets, invalid quantity and overflow in totals', () => {
    const occurrence = createDemoOccurrence('demo-small', layout);
    const nextSeatId = snapshot.seats[1]?.id ?? '';
    const pair = [
      { kind: 'seat' as const, seatId },
      { kind: 'seat' as const, seatId: nextSeatId },
    ];
    const mixed = {
      ...occurrence,
      prices: {
        ...occurrence.prices,
        seats: {
          ...occurrence.prices.seats,
          [nextSeatId]: { amount: 1, currency: 'EUR' },
        },
      },
    };
    expect(() => getDemoTotal(mixed, pair)).toThrow('валют');
    expect(() => getDemoTotal(occurrence, [pair[0]!, pair[0]!])).toThrow(
      'Повтор',
    );
    const zoneId = snapshot.zones[0]?.id ?? '';
    expect(() =>
      getDemoTotal(occurrence, [
        { kind: 'generalAdmission', zoneId, quantity: 1.5 },
      ]),
    ).toThrow('количество');
    const overflow = {
      ...occurrence,
      prices: {
        ...occurrence.prices,
        seats: {
          ...occurrence.prices.seats,
          [seatId]: { amount: 50_000_000_000_000, currency: 'RUB' },
          [nextSeatId]: { amount: 50_000_000_000_000, currency: 'RUB' },
        },
      },
    };
    expect(() => getDemoTotal(overflow, pair)).toThrow('стоимость');
  });

  it('keeps the newest occurrence when a delayed refresh returns', () => {
    const initial = createDemoOccurrence('demo-small', layout);
    const held = holdDemoSelection(
      initial,
      [{ kind: 'seat', seatId }],
      1000,
      'tab-a',
    );
    expect(held.revision).toBeGreaterThan(initial.revision);
    expect(preferLatestDemoOccurrence(held, initial)).toBe(held);
    expect(preferLatestDemoOccurrence(initial, held)).toBe(held);
    expect(
      preferLatestDemoOccurrence(held, createDemoOccurrence('other', layout)),
    ).toBe(held);
  });

  it('reserves general admission capacity and prevents overselling', () => {
    const parsedSnapshot = layoutDocumentSchema.parse(
      banquetHall.document,
    ).snapshot;
    const emptyZone = parsedSnapshot.zones.find(
      (zone) => !parsedSnapshot.seats.some((seat) => seat.zoneId === zone.id),
    );
    if (!emptyZone) throw new Error('Fixture needs an empty zone for explicit GA setup');
    const banquetSnapshot = layoutSnapshotSchema.parse({
      ...parsedSnapshot,
      zones: parsedSnapshot.zones.map((zone) =>
        zone.id === emptyZone.id ? { ...zone, kind: 'ga', capacity: 20 } : zone,
      ),
    });
    const occurrence = createDemoOccurrence('demo-banquet', {
      hallName: 'Banquet Hall',
      snapshot: banquetSnapshot,
    });
    const held = holdDemoSelection(
      occurrence,
      [{ kind: 'generalAdmission', zoneId: emptyZone.id, quantity: 6 }],
      1000,
    );
    expect(
      getDemoAvailability(held, 1000).zones?.[emptyZone.id]?.available,
    ).toBe(14);
    const twice = holdDemoSelection(
      held,
      [{ kind: 'generalAdmission', zoneId: emptyZone.id, quantity: 6 }],
      1001,
    );
    const three = holdDemoSelection(
      twice,
      [{ kind: 'generalAdmission', zoneId: emptyZone.id, quantity: 6 }],
      1002,
    );
    expect(() =>
      holdDemoSelection(
        three,
        [{ kind: 'generalAdmission', zoneId: emptyZone.id, quantity: 6 }],
        1003,
      ),
    ).toThrow('Недостаточно билетов');
  });
});

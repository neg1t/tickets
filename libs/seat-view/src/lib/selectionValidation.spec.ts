import { describe, expect, it, vi } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import type {
  SeatAvailabilityMap,
  SeatPrice,
  SeatPriceMap,
  SeatSelectionItem,
} from './SeatView.js';
import { validateSeatPrice, validateSelection } from './selectionValidation.js';

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
const seat = snapshot.seats[0];
const secondSeat = snapshot.seats[1];
const zone = snapshot.zones[0];
if (!seat || !secondSeat || !zone) throw new Error('Fixture is incomplete');

const layout = { hallName: 'Theater', snapshot };
const availability: SeatAvailabilityMap = {
  seats: { [seat.id]: 'available', [secondSeat.id]: 'available' },
  zones: { [zone.id]: { available: 3, maxPerOrder: 2 } },
};
const prices: SeatPriceMap = {
  seats: {
    [seat.id]: { amount: 1500, currency: 'RUB' },
    [secondSeat.id]: { amount: 0.29, currency: 'RUB' },
  },
  zones: { [zone.id]: { amount: 500, currency: 'RUB' } },
};
const seatSelection: SeatSelectionItem[] = [{ kind: 'seat', seatId: seat.id }];

function validate(
  selection: readonly SeatSelectionItem[],
  overrides: {
    availability?: SeatAvailabilityMap;
    prices?: SeatPriceMap;
  } = {},
) {
  return validateSelection({
    layout,
    selection,
    availability: overrides.availability ?? availability,
    prices: overrides.prices ?? prices,
  });
}

describe('validateSeatPrice', () => {
  it('treats amount as major currency units and preserves RUB kopecks', () => {
    expect(validateSeatPrice({ amount: 1500.29, currency: 'RUB' })).toEqual({
      valid: true,
      currency: 'RUB',
      fractionDigits: 2,
      minorUnits: 150029,
    });
  });

  it('uses ISO currency fraction digits', () => {
    expect(validateSeatPrice({ amount: 1500, currency: 'JPY' })).toMatchObject({
      valid: true,
      fractionDigits: 0,
      minorUnits: 1500,
    });
    expect(validateSeatPrice({ amount: 1.234, currency: 'KWD' })).toMatchObject(
      {
        valid: true,
        fractionDigits: 3,
        minorUnits: 1234,
      },
    );
  });

  it('caches currency fraction digits after the first valid price check', () => {
    const resolvedOptions = vi.spyOn(
      Intl.NumberFormat.prototype,
      'resolvedOptions',
    );

    validateSeatPrice({ amount: 12, currency: 'CZK' });
    const firstCheckCalls = resolvedOptions.mock.calls.length;
    validateSeatPrice({ amount: 13, currency: 'CZK' });

    expect(firstCheckCalls).toBeGreaterThan(0);
    expect(resolvedOptions).toHaveBeenCalledTimes(firstCheckCalls);
    resolvedOptions.mockRestore();
  });

  it.each([
    undefined,
    null,
    0,
    { currency: 'RUB' },
    { amount: Number.NaN, currency: 'RUB' },
    { amount: Number.POSITIVE_INFINITY, currency: 'RUB' },
    { amount: -1, currency: 'RUB' },
    { amount: 1.001, currency: 'RUB' },
    { amount: 1.2, currency: 'JPY' },
    { amount: 1, currency: 'ZZZ' },
    { amount: 1, currency: 'rub' },
    { amount: 1e15, currency: 'RUB' },
  ])('rejects a missing or malformed price %#', (price) => {
    expect(validateSeatPrice(price as SeatPrice | undefined)).toMatchObject({
      valid: false,
    });
  });
});

describe('validateSelection', () => {
  it('adds prices in integer minor units for seats and GA quantity', () => {
    expect(
      validate([
        { kind: 'seat', seatId: secondSeat.id },
        { kind: 'generalAdmission', zoneId: zone.id, quantity: 2 },
      ]),
    ).toEqual({
      valid: true,
      issues: [],
      count: 3,
      total: { amount: 1000.29, currency: 'RUB', minorUnits: 100029 },
    });
  });

  it('rejects empty selection', () => {
    expect(validate([])).toMatchObject({
      valid: false,
      total: null,
      issues: [{ code: 'empty_selection' }],
    });
  });

  it('rejects duplicate seat and GA items', () => {
    const result = validate([
      ...seatSelection,
      ...seatSelection,
      { kind: 'generalAdmission', zoneId: zone.id, quantity: 1 },
      { kind: 'generalAdmission', zoneId: zone.id, quantity: 1 },
    ]);
    expect(
      result.issues.filter(
        (issue: { code: string }) => issue.code === 'duplicate_item',
      ),
    ).toHaveLength(2);
    expect(result.total).toBeNull();
  });

  it('rejects missing or invalid price without treating it as free', () => {
    expect(
      validate(seatSelection, { prices: { seats: {} } }).issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'missing_price', id: seat.id }),
    );
    expect(
      validate(seatSelection, {
        prices: { seats: { [seat.id]: { amount: -5, currency: 'RUB' } } },
      }).issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'invalid_price', id: seat.id }),
    );
  });

  it('rejects mixed currencies', () => {
    const result = validate(
      [...seatSelection, { kind: 'seat', seatId: secondSeat.id }],
      {
        prices: {
          seats: {
            [seat.id]: { amount: 1500, currency: 'RUB' },
            [secondSeat.id]: { amount: 20, currency: 'USD' },
          },
        },
      },
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'mixed_currencies' }),
    );
    expect(result.total).toBeNull();
  });

  it('checks seat identity and availability', () => {
    expect(
      validate([{ kind: 'seat', seatId: 'missing' }]).issues,
    ).toContainEqual(expect.objectContaining({ code: 'unknown_seat' }));
    expect(
      validate(seatSelection, {
        availability: { seats: { [seat.id]: 'held' } },
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'unavailable_seat' }));
    expect(validate([{ kind: 'seat', seatId: ' ' }]).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_id' }),
    );
  });

  it('uses memoized identity sets instead of scanning the layout for every selection', () => {
    const forbidArrayScan = <T>(items: readonly T[]): T[] =>
      new Proxy([...items], {
        get(target, property, receiver) {
          if (property === 'map' || property === Symbol.iterator)
            throw new Error('validateSelection rescanned the layout');
          return Reflect.get(target, property, receiver);
        },
      });
    const indexedLayout = {
      ...layout,
      snapshot: {
        ...layout.snapshot,
        seats: forbidArrayScan(layout.snapshot.seats),
        zones: forbidArrayScan(layout.snapshot.zones),
      },
    };

    expect(
      validateSelection({
        layout: indexedLayout,
        selection: seatSelection,
        availability,
        prices,
        seatIds: new Set([seat.id]),
        zoneIds: new Set([zone.id]),
      }),
    ).toMatchObject({ valid: true });
  });

  it('checks GA quantity, stock, and order limit', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(
        validate([{ kind: 'generalAdmission', zoneId: zone.id, quantity }])
          .issues,
      ).toContainEqual(expect.objectContaining({ code: 'invalid_quantity' }));
    }
    expect(
      validate([{ kind: 'generalAdmission', zoneId: zone.id, quantity: 4 }])
        .issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'quantity_exceeds_availability' }),
    );
    expect(
      validate([{ kind: 'generalAdmission', zoneId: zone.id, quantity: 3 }])
        .issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'quantity_exceeds_limit' }),
    );
    expect(
      validate([{ kind: 'generalAdmission', zoneId: 'missing', quantity: 1 }])
        .issues,
    ).toContainEqual(expect.objectContaining({ code: 'unknown_zone' }));
    expect(
      validate([{ kind: 'generalAdmission', zoneId: zone.id, quantity: 1 }], {
        availability: { seats: {}, zones: { [zone.id]: { available: 0 } } },
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'unavailable_zone' }));
  });

  it('rejects unsupported runtime item kinds', () => {
    const selection = [
      { kind: 'standing', seatId: seat.id },
    ] as unknown as SeatSelectionItem[];
    expect(validate(selection).issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_item' }),
    );
  });
});

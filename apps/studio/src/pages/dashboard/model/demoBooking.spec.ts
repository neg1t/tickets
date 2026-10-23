import { describe, expect, it } from 'vitest';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import banquetHall from '@hall-platform/fixtures/banquet-hall.json';
import { layoutDocumentSchema } from '@hall-platform/domain';
import {
  createDemoOccurrence,
  getDemoAvailability,
  holdDemoSelection,
  confirmDemoHold,
  cancelDemoHold,
  getDemoTotal,
} from './demoBooking.js';

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
const layout = { hallName: 'Small Theater', snapshot };
const seatId = snapshot.seats[0]?.id ?? '';

describe('demo booking', () => {
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

  it('reserves general admission capacity and prevents overselling', () => {
    const banquetSnapshot = layoutDocumentSchema.parse(
      banquetHall.document,
    ).snapshot;
    const emptyZone = banquetSnapshot.zones.find(
      (zone) => !banquetSnapshot.seats.some((seat) => seat.zoneId === zone.id),
    );
    if (!emptyZone) throw new Error('Fixture needs a general admission zone');
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

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemoOccurrence } from '../model/demoBooking.js';
import { BuyerPage } from './BuyerPage.js';

const seatViewRender = vi.hoisted(() => vi.fn());

vi.mock('@hall-platform/seat-view', () => ({
  SeatView: (props: { purchaseDisabled?: boolean }) => {
    seatViewRender();
    return <div data-testid="seat-view"><button disabled={props.purchaseDisabled}>Купить</button></div>;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  seatViewRender.mockClear();
});

const occurrence = {
  id: 'demo-1',
  revision: 0,
  hallId: 'hall-1',
  title: 'Hall demo',
  startsAt: '2026-11-03T12:00:00.000Z',
  layout: {
    hallName: 'Hall',
    snapshot: {
      id: 'snapshot-1',
      floors: [],
      zones: [],
      rows: [],
      tables: [],
      seats: [],
      backgrounds: [],
      decorations: [],
    },
  },
  initialSeats: {},
  zoneCapacity: {},
  prices: { seats: {}, zones: {} },
  holds: [],
  orders: [],
} as unknown as DemoOccurrence;

describe('BuyerPage idle rendering', () => {
  it('does not rerender the seat map on countdown ticks when there is no active hold', () => {
    vi.useFakeTimers();
    render(
      <BuyerPage
        occurrence={occurrence}
        activeHoldId={null}
        receipt={null}
        error={null}
        selection={[]}
        onBack={() => undefined}
        onSelectionChange={() => undefined}
        onHold={async () => undefined}
        onConfirm={async () => undefined}
        onCancel={async () => undefined}
        onReopen={async () => undefined}
      />,
    );

    expect(screen.getByTestId('seat-view')).toBeTruthy();
    const initialRenderCount = seatViewRender.mock.calls.length;
    expect(initialRenderCount).toBe(1);

    act(() => vi.advanceTimersByTime(3000));

    expect(seatViewRender).toHaveBeenCalledTimes(initialRenderCount);
  });

  it('refreshes availability when another hold expires without a one-second redraw loop', () => {
    vi.useFakeTimers();
    const otherHold: DemoOccurrence = {
      ...occurrence,
      holds: [
        {
          id: 'other-hold',
          ownerId: 'another-tab',
          selection: [],
          quote: { schemaVersion: 1, lines: [{ targetKind: 'seat', targetId: 'seat-1', quantity: 1, unitAmountMinor: 100, currency: 'RUB' }], total: { amountMinor: 100, currency: 'RUB' } },
          expiresAt: Date.now() + 2000,
        },
      ],
    };
    render(
      <BuyerPage
        occurrence={otherHold}
        activeHoldId={null}
        receipt={null}
        error={null}
        selection={[]}
        onBack={() => undefined}
        onSelectionChange={() => undefined}
        onHold={async () => undefined}
        onConfirm={async () => undefined}
        onCancel={async () => undefined}
        onReopen={async () => undefined}
      />,
    );
    const initialRenderCount = seatViewRender.mock.calls.length;

    act(() => vi.advanceTimersByTime(1500));
    expect(seatViewRender).toHaveBeenCalledTimes(initialRenderCount);
    act(() => vi.advanceTimersByTime(501));

    expect(seatViewRender).toHaveBeenCalledTimes(initialRenderCount + 1);
  });
});

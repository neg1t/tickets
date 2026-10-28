import { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutDocumentSchema, seatIdSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import {
  SeatView,
  type SeatSelectionItem,
  type SeatViewData,
} from './SeatView.js';

vi.mock('@hall-platform/hall-viewer', () => ({
  HallViewport: (props: {
    stageId: string;
    viewerMode?: 'edit' | 'view' | 'pick';
    activeTool?: string;
    labels?: { zoomIn?: string };
  }) => (
    <div
      data-testid="hall-viewer"
      data-stage-id={props.stageId}
      data-viewer-mode={props.viewerMode}
      data-active-tool={props.activeTool}
      data-zoom-in-label={props.labels?.zoomIn}
    />
  ),
}));
afterEach(cleanup);

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
const first = snapshot.seats[0];
const second = snapshot.seats[1];
const zone = snapshot.zones[0];
if (!first || !second || !zone) throw new Error('Fixture is incomplete');

const layout = {
  hallName: 'Малый театр',
  snapshot: { ...snapshot, seats: [first, second] },
};
const availability = {
  seats: { [first.id]: 'available', [second.id]: 'sold' },
  zones: { [zone.id]: { available: 3, maxPerOrder: 2 } },
} as const;
const prices = {
  seats: {
    [first.id]: { amount: 1200, currency: 'RUB', category: 'Партер' },
    [second.id]: { amount: 900, currency: 'RUB' },
  },
  zones: { [zone.id]: { amount: 500, currency: 'RUB' } },
};

function ControlledView(props: {
  readonly name: string;
  readonly onBuyClick?: (data: SeatViewData) => void | Promise<void>;
}) {
  const [selection, setSelection] = useState<SeatSelectionItem[]>([]);
  return (
    <section aria-label={props.name}>
      <SeatView
        layout={layout}
        occurrenceId={props.name}
        availability={availability}
        prices={prices}
        selection={selection}
        onSelectionChange={setSelection}
        onBuyClick={props.onBuyClick ?? (() => undefined)}
      />
    </section>
  );
}

function ClonedControlledView(props: { readonly name: string }) {
  const [selection, setSelection] = useState<SeatSelectionItem[]>([]);
  return (
    <SeatView
      layout={layout}
      occurrenceId={props.name}
      availability={availability}
      prices={prices}
      selection={selection.map((item) => ({ ...item }))}
      onSelectionChange={(next) => setSelection(structuredClone(next))}
      onBuyClick={() => undefined}
    />
  );
}

describe('SeatView', () => {
  it('uses the pick interaction mode without entering editor tools', () => {
    render(<ControlledView name="pick-mode" />);
    const viewer = screen.getByTestId('hall-viewer');

    expect(viewer.getAttribute('data-viewer-mode')).toBe('pick');
    expect(viewer.getAttribute('data-active-tool')).toBeNull();
  });

  it('can disable purchase while keeping the buyer price preview selectable', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="preview-only"
        availability={availability}
        prices={prices}
        selection={[{ kind: 'seat', seatId: first.id }]}
        purchaseDisabled
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );

    expect((screen.getByRole('button', { name: 'Купить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('limits a large seat list while preserving search and keyboard navigation', () => {
    const seatPrice = prices.seats[first.id];
    if (!seatPrice) throw new Error('Missing seat price');
    const manySeats = Array.from({ length: 10000 }, (_, index) => ({
      ...first,
      id: seatIdSchema.parse(`seat-${index}`),
      label: `B-${index}`,
    }));
    const manyAvailability = Object.fromEntries(
      manySeats.map((seat) => [seat.id, 'available' as const]),
    );
    const manyPrices = Object.fromEntries(
      manySeats.map((seat) => [seat.id, seatPrice]),
    );
    render(
      <SeatView
        layout={{ ...layout, snapshot: { ...snapshot, seats: manySeats } }}
        occurrenceId="large-event"
        availability={{ seats: manyAvailability }}
        prices={{ seats: manyPrices }}
        selection={[]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );

    const list = document.querySelector('.seat-view-seat-list');
    if (!list) throw new Error('Accessible seat list is missing');
    expect(list.querySelectorAll('button').length).toBeLessThanOrEqual(80);
    expect(
      screen.queryByRole('button', { name: /^Место B-9999 —/ }),
    ).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Места' }), {
      target: { value: 'B-9999' },
    });
    expect(
      screen.getByRole('button', { name: /^Место B-9999 —/ }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Места' }), {
      target: { value: '' },
    });

    const lastOnFirstPage = screen.getByRole('button', {
      name: /^Место B-79(?:\D|$)/,
    });
    lastOnFirstPage.focus();
    fireEvent.keyDown(lastOnFirstPage, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^Место B-80(?:\D|$)/ }),
    );
    expect(list.querySelectorAll('button').length).toBeLessThanOrEqual(80);
  });

  it('A08: rejects duplicate seats supplied by a controlled host', () => {
    const onBuyClick = vi.fn();
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[
          { kind: 'seat', seatId: first.id },
          { kind: 'seat', seatId: first.id },
        ]}
        onSelectionChange={() => undefined}
        onBuyClick={onBuyClick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Купить' }));
    expect(onBuyClick).not.toHaveBeenCalled();
  });

  it('shows the full place address and price when a seat is selected', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[{ kind: 'seat', seatId: first.id }]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );
    const details = screen.getByRole('region', { name: 'Информация о месте' });
    expect(details.textContent).toContain('Малый театр');
    expect(details.textContent).toContain('Main floor');
    expect(details.textContent).toContain('Left sector');
    expect(details.textContent).toContain('Ряд');
    expect(details.textContent).toContain('L1-1');
    expect(details.textContent).toContain('1 200');
    expect(screen.getByLabelText('Ценовые категории').textContent).toContain(
      'Партер',
    );
  });

  it('disables checkout for a malformed price and names the pricing problem', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={{
          ...prices,
          seats: {
            ...prices.seats,
            [first.id]: { amount: Number.NaN, currency: 'RUB' },
          },
        }}
        selection={[{ kind: 'seat', seatId: first.id }]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Купить' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('цена');
  });

  it('reports a malformed controlled selection without crashing the screen', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[null] as unknown as SeatSelectionItem[]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Купить' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('недоступны');
  });

  it('uses controlled selection and sends it to the host on buy', async () => {
    const onBuyClick = vi.fn();
    render(<ControlledView name="event-1" onBuyClick={onBuyClick} />);

    fireEvent.click(screen.getByRole('button', { name: /^Место L1-1/ }));
    expect(screen.getByText('Выбрано: 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Купить' }));
    expect(onBuyClick).toHaveBeenCalledWith({
      occurrenceId: 'event-1',
      selection: [{ kind: 'seat', seatId: first.id }],
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Купить' }).hasAttribute('disabled'),
      ).toBe(false),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Место L1-1/ }));
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('accepts controlled selection echoes as cloned item objects', () => {
    render(<ClonedControlledView name="cloned-echo" />);

    fireEvent.click(screen.getByRole('button', { name: /^Место L1-1/ }));
    expect(screen.getByText('Выбрано: 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Место L1-1/ }));
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('disables sold seats and limits general admission quantity', () => {
    const onBuyClick = vi.fn();
    render(<ControlledView name="event-1" onBuyClick={onBuyClick} />);

    expect(
      screen
        .getByRole('button', { name: /Место L1-2/ })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Left sector/ }), {
      target: { value: '2' },
    });
    expect(screen.getByText('Выбрано: 2')).toBeTruthy();
    expect(
      screen
        .getByRole('spinbutton', { name: /Left sector/ })
        .getAttribute('max'),
    ).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Купить' }));
    expect(onBuyClick).toHaveBeenCalledWith({
      occurrenceId: 'event-1',
      selection: [{ kind: 'generalAdmission', zoneId: zone.id, quantity: 2 }],
    });
  });

  it('keeps two mounted instances independent', () => {
    render(
      <>
        <ControlledView name="event-1" />
        <ControlledView name="event-2" />
      </>,
    );
    const firstView = within(screen.getByRole('region', { name: 'event-1' }));
    const secondView = within(screen.getByRole('region', { name: 'event-2' }));

    fireEvent.click(firstView.getByRole('button', { name: /Место L1-1/ }));
    expect(firstView.getByText('Выбрано: 1')).toBeTruthy();
    expect(secondView.getByText('Выбрано: 0')).toBeTruthy();
    fireEvent.change(firstView.getByRole('combobox', { name: 'Все сектора' }), {
      target: { value: zone.id },
    });
    expect(
      (
        firstView.getByRole('combobox', {
          name: 'Все сектора',
        }) as HTMLSelectElement
      ).value,
    ).toBe(zone.id);
    expect(
      (
        secondView.getByRole('combobox', {
          name: 'Все сектора',
        }) as HTMLSelectElement
      ).value,
    ).toBe('');
    expect(
      firstView.getByTestId('hall-viewer').getAttribute('data-stage-id'),
    ).not.toBe(
      secondView.getByTestId('hall-viewer').getAttribute('data-stage-id'),
    );
  });

  it('moves keyboard focus through available seats in the accessible list', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={{
          ...availability,
          seats: { [first.id]: 'available', [second.id]: 'available' },
        }}
        prices={prices}
        selection={[]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );
    const firstButton = screen.getByRole('button', { name: /^Место L1-1/ });
    const secondButton = screen.getByRole('button', { name: /^Место L1-2/ });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(secondButton);
  });

  it('shows the full address of a focused seat even when another seat is selected', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={{
          ...availability,
          seats: { [first.id]: 'available', [second.id]: 'available' },
        }}
        prices={prices}
        selection={[{ kind: 'seat', seatId: first.id }]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );
    const secondButton = screen.getByRole('button', { name: /^Место L1-2/ });
    expect((secondButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.focus(secondButton);
    const details = screen.getByRole('region', { name: 'Информация о месте' });
    expect(details.textContent).toContain('L1-2');
    expect(details.textContent).toContain('Малый театр');
    expect(secondButton.textContent).toContain('Main floor');
    expect(secondButton.textContent).toContain('Left sector');
  });

  it('does not change selection until the host updates its prop', () => {
    const onSelectionChange = vi.fn();
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[]}
        onSelectionChange={onSelectionChange}
        onBuyClick={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Место L1-1/ }));
    expect(onSelectionChange).toHaveBeenCalledWith([
      { kind: 'seat', seatId: first.id },
    ]);
    expect(screen.getByText('Выбрано: 0')).toBeTruthy();
  });

  it('blocks buying when a controlled selection becomes unavailable', () => {
    const onSelectionChange = vi.fn();
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[{ kind: 'seat', seatId: second.id }]}
        onSelectionChange={onSelectionChange}
        onBuyClick={() => undefined}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Купить' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain(
      'больше недоступны',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Место L1-2/ }));
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('applies availability deltas and requests a snapshot after a revision gap', async () => {
    const onAvailabilityResync = vi.fn();
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={{
          ...availability,
          seats: { ...availability.seats, [first.id]: 'available' },
        }}
        availabilityRevision={10}
        availabilityDeltas={[
          {
            baseRevision: 10,
            revision: 11,
            seats: { [first.id]: 'sold' },
          },
        ]}
        prices={prices}
        selection={[{ kind: 'seat', seatId: first.id }]}
        onSelectionChange={onSelectionChange}
        onBuyClick={() => undefined}
        onAvailabilityResync={onAvailabilityResync}
      />,
    );

    const soldSeat = screen.getByRole('button', { name: /^Место L1-1/ });
    // A selected seat that becomes unavailable remains removable from the basket.
    expect((soldSeat as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(soldSeat);
    expect(onSelectionChange).toHaveBeenCalledWith([]);
    expect(soldSeat.getAttribute('aria-label')).toContain('продано');
    expect(
      screen.getByRole('button', { name: 'Купить' }).hasAttribute('disabled'),
    ).toBe(true);

    rerender(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={{
          ...availability,
          seats: { ...availability.seats, [first.id]: 'available' },
        }}
        availabilityRevision={11}
        availabilityDeltas={[
          {
            baseRevision: 15,
            revision: 16,
            seats: { [first.id]: 'available' },
          },
        ]}
        prices={prices}
        selection={[]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
        onAvailabilityResync={onAvailabilityResync}
      />,
    );

    await waitFor(() => expect(onAvailabilityResync).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByRole('button', { name: /^Место L1-1/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('allows removing a selected general admission item after stock reaches zero', () => {
    const onSelectionChange = vi.fn();
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={{
          ...availability,
          zones: { [zone.id]: { available: 0 } },
        }}
        prices={prices}
        selection={[{ kind: 'generalAdmission', zoneId: zone.id, quantity: 2 }]}
        onSelectionChange={onSelectionChange}
        onBuyClick={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Убрать.*Left sector/ }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('filters general admission by section', () => {
    const otherZone = snapshot.zones[1];
    if (!otherZone) throw new Error('Second zone is missing');
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={{
          ...availability,
          zones: {
            ...availability.zones,
            [otherZone.id]: { available: 5 },
          },
        }}
        prices={prices}
        selection={[]}
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Все сектора' }), {
      target: { value: zone.id },
    });
    expect(
      screen.getByRole('spinbutton', { name: /Left sector/ }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('spinbutton', { name: /Center sector/ }),
    ).toBeNull();
  });

  it('localizes buyer controls and viewer labels', () => {
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[]}
        locale="en-US"
        onSelectionChange={() => undefined}
        onBuyClick={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Seat legend')).toBeTruthy();
    expect(
      screen.getByTestId('hall-viewer').getAttribute('data-zoom-in-label'),
    ).toBe('Zoom in');
  });

  it('clears local filters when the occurrence changes', () => {
    const common = {
      layout,
      availability,
      prices,
      selection: [] as SeatSelectionItem[],
      onSelectionChange: () => undefined,
      onBuyClick: () => undefined,
    };
    const view = render(<SeatView {...common} occurrenceId="event-1" />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Места' }), {
      target: { value: 'L1-1' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только доступные' }));
    view.rerender(<SeatView {...common} occurrenceId="event-2" />);
    expect(
      (screen.getByRole('searchbox', { name: 'Места' }) as HTMLInputElement)
        .value,
    ).toBe('');
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Только доступные',
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it('does not show a late checkout error from a previous occurrence', async () => {
    let rejectPrevious: (error: Error) => void = () => undefined;
    const onError = vi.fn();
    const previousBuy = () =>
      new Promise<void>((_resolve, reject) => {
        rejectPrevious = reject;
      });
    const common = {
      layout,
      availability,
      prices,
      selection: [{ kind: 'seat' as const, seatId: first.id }],
      onSelectionChange: () => undefined,
      onError,
    };
    const view = render(
      <SeatView {...common} occurrenceId="event-1" onBuyClick={previousBuy} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Купить' }));
    view.rerender(
      <SeatView
        {...common}
        occurrenceId="event-2"
        onBuyClick={() => undefined}
      />,
    );
    await act(async () => {
      rejectPrevious(new Error('Old checkout failed'));
    });
    expect(screen.queryByText('Old checkout failed')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a rejected buy callback without changing the controlled selection', async () => {
    const onError = vi.fn();
    render(
      <SeatView
        layout={layout}
        occurrenceId="event-1"
        availability={availability}
        prices={prices}
        selection={[{ kind: 'seat', seatId: first.id }]}
        onSelectionChange={() => undefined}
        onBuyClick={async () => {
          throw new Error('Checkout failed');
        }}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Купить' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Checkout failed',
      ),
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByText('Выбрано: 1')).toBeTruthy();
  });
});

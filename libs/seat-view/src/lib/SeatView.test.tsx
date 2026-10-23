import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import {
  SeatView,
  type SeatSelectionItem,
  type SeatViewData,
} from './SeatView.js';

vi.mock('@hall-platform/renderer-konva', () => ({
  HallViewer: (props: { stageId: string; labels?: { zoomIn?: string } }) => (
    <div
      data-testid="hall-viewer"
      data-stage-id={props.stageId}
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

describe('SeatView', () => {
  it.fails('A08: rejects duplicate seats supplied by a controlled host', () => {
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

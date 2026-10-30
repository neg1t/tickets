import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import type { HallTarget } from '@hall-platform/renderer-core';
import { SeatMap } from './SeatMap.js';
import { SeatSelectionProvider } from './SeatSelectionProvider.js';
import type { SeatSelectionItem } from './SeatView.js';
import { useSeatSelection } from './useSeatSelection.js';

vi.mock('@hall-platform/hall-viewer', () => ({
  HallViewport: (props: {
    readonly selectedTargets: readonly HallTarget[];
    readonly snapshot: { readonly backgrounds: readonly unknown[] };
    readonly onCanvasClick: (point: unknown, target: HallTarget | null) => void;
  }) => (
    <div
      data-testid="seat-map-canvas"
      data-selected-targets={props.selectedTargets.map((target) => target.id).join(',')}
      data-selected-target-kinds={props.selectedTargets.map((target) => target.kind).join(',')}
      data-background-count={props.snapshot.backgrounds.length}
    >
      <button
        type="button"
        aria-label="Pick first seat"
        onClick={() => props.onCanvasClick({ x: 1, y: 1 }, { kind: 'seat', id: 'seat-1' })}
      />
    </div>
  ),
}));

afterEach(cleanup);

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
function requiredFixtureItem<T>(item: T | undefined): T {
  if (!item) throw new Error('Fixture is incomplete');
  return item;
}
const seat = requiredFixtureItem(snapshot.seats[0]);
const zone = requiredFixtureItem(snapshot.zones[0]);
const layout = { hallName: 'Theater', snapshot };
const availability = {
  seats: { [seat.id]: 'available' as const },
  zones: { [zone.id]: { available: 3, maxPerOrder: 2 } },
};
const prices = {
  seats: { [seat.id]: { amount: 100, currency: 'RUB' } },
  zones: { [zone.id]: { amount: 50, currency: 'RUB' } },
};

describe('SeatMap', () => {
  it('uses the provider selection and renders without the legacy basket', () => {
    const onSelectionChange = vi.fn();
    const onSeatClick = vi.fn();
    const selection: SeatSelectionItem[] = [
      { kind: 'seat', seatId: seat.id },
      { kind: 'generalAdmission', zoneId: 'zone-1', quantity: 2 },
    ];
    render(
      <SeatSelectionProvider
        selection={selection}
        onSelectionChange={onSelectionChange}
      >
        <SeatMap
          layout={{ hallName: 'Theater', snapshot }}
          availability={{ seats: { [seat.id]: 'available' } }}
          focusedFloorId={snapshot.floors[0]?.id ?? ''}
          onSeatClick={onSeatClick}
          onZoneClick={() => undefined}
          onFloorChange={() => undefined}
        />
      </SeatSelectionProvider>,
    );

    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargets).toBe(
      `${seat.id},zone-1`,
    );
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargetKinds).toBe(
      'seat,zone',
    );
    expect(screen.getByTestId('seat-map-canvas').dataset.backgroundCount).toBe(
      '0',
    );
    expect(screen.queryByRole('button', { name: 'Купить' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Pick first seat' }));
    expect(onSeatClick).toHaveBeenCalledWith('seat-1');
  });

  it('requires explicit shared selection context', () => {
    expect(() =>
      render(
        <SeatMap
          layout={{ hallName: 'Theater', snapshot }}
          availability={{ seats: {} }}
          focusedFloorId={snapshot.floors[0]?.id ?? ''}
          onSeatClick={() => undefined}
          onZoneClick={() => undefined}
          onFloorChange={() => undefined}
        />,
      ),
    ).toThrow('Seat selection components must be inside SeatSelectionProvider');
  });

  it('uses the same reusable seat and GA actions as its map and selection list', () => {
    function SelectionActions() {
      const actions = useSeatSelection({
        layout,
        availability,
        prices,
      });
      return (
        <>
          <span data-testid="toggle-seat-type">{typeof actions.toggleSeat}</span>
          <output data-testid="selection-action-error">
            {actions.actionError ?? 'none'}
          </output>
          <button type="button" onClick={() => actions.toggleSeat(seat.id)}>
            Add seat
          </button>
          <button
            type="button"
            onClick={() => actions.setGeneralAdmissionQuantity(zone.id, '2')}
          >
            Set GA quantity
          </button>
          <button
            type="button"
            onClick={() => actions.setGeneralAdmissionQuantity(zone.id, '4')}
          >
            Set invalid GA quantity
          </button>
          <button
            type="button"
            onClick={() => actions.removeSelection(`seat:${seat.id}`)}
          >
            Remove seat
          </button>
          <button
            type="button"
            onClick={() => actions.removeSelection(`zone:${zone.id}`)}
          >
            Remove GA
          </button>
        </>
      );
    }

    function SharedComposition() {
      const [selection, setSelection] = useState<SeatSelectionItem[]>([]);
      return (
        <SeatSelectionProvider
          selection={selection}
          onSelectionChange={setSelection}
        >
          <SelectionActions />
          <SeatMap
            layout={layout}
            availability={availability}
            focusedFloorId={snapshot.floors[0]?.id ?? ''}
            onSeatClick={() => undefined}
            onZoneClick={() => undefined}
            onFloorChange={() => undefined}
          />
        </SeatSelectionProvider>
      );
    }

    render(<SharedComposition />);

    expect(screen.getByTestId('toggle-seat-type').textContent).toBe('function');
    fireEvent.click(screen.getByRole('button', { name: 'Add seat' }));
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargets).toBe(
      seat.id,
    );
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargetKinds).toBe(
      'seat',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set GA quantity' }));
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargets).toBe(
      `${seat.id},${zone.id}`,
    );
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargetKinds).toBe(
      'seat,zone',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove seat' }));
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargets).toBe(
      zone.id,
    );
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargetKinds).toBe(
      'zone',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove GA' }));
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargets).toBe('');
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargetKinds).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Set invalid GA quantity' }));
    expect(screen.getByTestId('selection-action-error').textContent).toBe(
      'quantity_exceeds_availability',
    );
    expect(screen.getByTestId('seat-map-canvas').dataset.selectedTargets).toBe('');
  });

  it('reports an unavailable selection conflict through the public controller', () => {
    function SelectionConflict() {
      const controller = useSeatSelection({
        layout,
        availability: { seats: { [seat.id]: 'held' } },
        prices,
      });
      return (
        <output data-testid="selection-conflict">
          {controller.validation.issues[0]?.code ?? 'none'}
        </output>
      );
    }

    render(
      <SeatSelectionProvider
        selection={[{ kind: 'seat', seatId: seat.id }]}
        onSelectionChange={() => undefined}
      >
        <SelectionConflict />
      </SeatSelectionProvider>,
    );

    expect(screen.getByTestId('selection-conflict').textContent).toBe(
      'unavailable_seat',
    );
  });
});

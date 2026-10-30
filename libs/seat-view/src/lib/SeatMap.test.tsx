import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import type { HallTarget } from '@hall-platform/renderer-core';
import { SeatMap } from './SeatMap.js';
import { SeatSelectionProvider } from './SeatSelectionProvider.js';
import type { SeatSelectionItem } from './SeatView.js';

vi.mock('@hall-platform/hall-viewer', () => ({
  HallViewport: (props: {
    readonly selectedTargets: readonly HallTarget[];
    readonly snapshot: { readonly backgrounds: readonly unknown[] };
    readonly onCanvasClick: (point: unknown, target: HallTarget | null) => void;
  }) => (
    <div
      data-testid="seat-map-canvas"
      data-selected-targets={props.selectedTargets.map((target) => target.id).join(',')}
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
const seat = snapshot.seats[0];
if (!seat) throw new Error('Fixture has no seats');

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
      seat.id,
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
});

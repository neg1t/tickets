import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSeatViewEmbed,
  type SeatViewEmbedOptions,
} from './seatViewEmbed.js';
import type { SeatViewData } from './SeatView.js';

vi.mock('./SeatView.js', async () => {
  const React = await import('react');
  return {
    SeatView: (props: {
      layout: { hallName: string };
      occurrenceId: string;
      selection: readonly { kind: 'seat'; seatId: string }[];
      onSelectionChange: (
        selection: { kind: 'seat'; seatId: string }[],
      ) => void;
      onBuyClick: (data: {
        occurrenceId: string;
        selection: readonly { kind: 'seat'; seatId: string }[];
      }) => void;
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            'data-hall': props.layout.hallName,
            'data-occurrence': props.occurrenceId,
            onClick: () =>
              props.onSelectionChange([{ kind: 'seat', seatId: 'seat-1' }]),
          },
          props.layout.hallName,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () =>
              props.onBuyClick({
                occurrenceId: props.occurrenceId,
                selection: props.selection,
              }),
          },
          'Checkout',
        ),
      ),
  };
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function options(
  hallName: string,
  occurrenceId: string,
  onSelectionChange = vi.fn(),
): SeatViewEmbedOptions {
  return {
    layout: {
      hallName,
      snapshot: {} as SeatViewEmbedOptions['layout']['snapshot'],
    },
    occurrenceId,
    availability: { seats: {} },
    prices: { seats: {} },
    selection: [],
    onSelectionChange,
  };
}

describe('createSeatViewEmbed', () => {
  it('mounts independent instances and updates only the selected host', async () => {
    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');
    document.body.append(firstHost, secondHost);
    let firstEmbed: ReturnType<typeof createSeatViewEmbed>;
    let secondEmbed: ReturnType<typeof createSeatViewEmbed>;

    await act(async () => {
      firstEmbed = createSeatViewEmbed(
        firstHost,
        options('First Hall', 'show-1'),
      );
      secondEmbed = createSeatViewEmbed(
        secondHost,
        options('Second Hall', 'show-2'),
      );
    });

    expect(firstHost.querySelector('button')?.dataset.hall).toBe('First Hall');
    expect(secondHost.querySelector('button')?.dataset.hall).toBe(
      'Second Hall',
    );

    await act(async () => {
      firstEmbed.update({
        ...options('Updated Hall', 'show-3'),
        theme: 'dark',
        locale: 'en-US',
      });
    });
    expect(firstHost.querySelector('button')?.dataset.hall).toBe(
      'Updated Hall',
    );
    expect(firstHost.querySelector('button')?.dataset.occurrence).toBe(
      'show-3',
    );
    expect(
      firstHost.querySelector('.seat-view-embed')?.getAttribute('data-theme'),
    ).toBe('dark');
    expect(
      firstHost.querySelector('.seat-view-embed')?.getAttribute('data-locale'),
    ).toBe('en-US');
    expect(secondHost.querySelector('button')?.dataset.hall).toBe(
      'Second Hall',
    );

    await act(async () => firstEmbed.dispose());
    expect(firstHost.querySelector('button')).toBeNull();
    expect(secondHost.querySelector('button')).not.toBeNull();
    await act(async () => secondEmbed.dispose());
  });

  it('forwards selection events and reports observed host dimensions', async () => {
    const selectionChanged = vi.fn();
    const checkout = vi.fn();
    const resized = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    let observerCallback: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observerCallback = callback;
        }
        observe(target: Element) {
          observerCallback?.(
            [
              {
                target,
                contentRect: { width: 720, height: 410 } as DOMRectReadOnly,
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {
          return undefined;
        }
        disconnect = disconnect;
      },
    );

    let embed: ReturnType<typeof createSeatViewEmbed>;
    await act(async () => {
      embed = createSeatViewEmbed(host, {
        ...options('Hall', 'show-1', selectionChanged),
        onCheckout: checkout,
        onResize: resized,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Hall' }));
    expect(selectionChanged).toHaveBeenCalledWith([
      { kind: 'seat', seatId: 'seat-1' },
    ]);
    fireEvent.click(within(host).getByRole('button', { name: 'Checkout' }));
    expect(checkout).toHaveBeenCalledWith(
      { occurrenceId: 'show-1', selection: [] },
      expect.any(AbortSignal),
    );
    expect(resized).toHaveBeenCalledWith({ width: 720, height: 410 });
    expect(host.style.getPropertyValue('--seat-view-embed-width')).toBe(
      '720px',
    );

    await act(async () => embed.dispose());
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(host.style.getPropertyValue('--seat-view-embed-width')).toBe('');
  });

  it('rejects updates after disposal and makes dispose idempotent', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let embed: ReturnType<typeof createSeatViewEmbed>;
    await act(async () => {
      embed = createSeatViewEmbed(host, options('Hall', 'show-1'));
    });
    await act(async () => {
      embed.dispose();
      embed.dispose();
    });

    expect(() => embed.update(options('Hall', 'show-2'))).toThrow(
      'Seat view embed has been disposed',
    );
  });

  it('aborts checkout work when the event changes or the embed is disposed', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const signals: AbortSignal[] = [];
    const checkout = vi.fn((_data: SeatViewData, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    let embed: ReturnType<typeof createSeatViewEmbed>;
    await act(async () => {
      embed = createSeatViewEmbed(host, {
        ...options('Hall', 'show-1'),
        onCheckout: checkout,
      });
    });

    fireEvent.click(within(host).getByRole('button', { name: 'Checkout' }));
    expect(signals[0]?.aborted).toBe(false);
    await act(async () => {
      embed.update({
        ...options('Hall', 'show-2'),
        onCheckout: checkout,
      });
    });
    expect(signals[0]?.aborted).toBe(true);

    fireEvent.click(within(host).getByRole('button', { name: 'Checkout' }));
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => embed.dispose());
    expect(signals[1]?.aborted).toBe(true);
  });
});

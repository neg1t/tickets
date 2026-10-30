// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PurchaseDataSource } from './model/purchase.types.js';
import {
  TicketPurchaseProvider,
  useTicketPurchase,
} from './TicketPurchaseProvider.js';

const dataSource = {} as PurchaseDataSource;

afterEach(cleanup);

function Probe({ label }: { readonly label: string }) {
  const purchase = useTicketPurchase();
  return (
    <section aria-label={label}>
      <output>{purchase.step}</output>
      <button type="button" onClick={() => purchase.setStep('contacts')}>
        Continue {label}
      </button>
      <button type="button" onClick={() => purchase.hostActions.onHistory?.()}>
        History {label}
      </button>
      <button type="button" onClick={() => purchase.hostActions.onTickets?.()}>
        Tickets {label}
      </button>
    </section>
  );
}

describe('TicketPurchaseProvider', () => {
  it('keeps controller state and host actions isolated per widget instance', () => {
    const onFirstHistory = vi.fn();
    const onSecondHistory = vi.fn();
    const onFirstTickets = vi.fn();
    render(
      <>
        <TicketPurchaseProvider
          dataSource={dataSource}
          instanceId="first"
          hostActions={{ onHistory: onFirstHistory, onTickets: onFirstTickets }}
        >
          <Probe label="first" />
        </TicketPurchaseProvider>
        <TicketPurchaseProvider
          dataSource={dataSource}
          instanceId="second"
          hostActions={{ onHistory: onSecondHistory }}
        >
          <Probe label="second" />
        </TicketPurchaseProvider>
      </>,
    );

    const sections = screen.getAllByRole('region');
    expect(sections[0]?.querySelector('output')?.textContent).toBe('selection');
    expect(sections[1]?.querySelector('output')?.textContent).toBe('selection');

    fireEvent.click(screen.getByRole('button', { name: 'Continue first' }));
    expect(sections[0]?.querySelector('output')?.textContent).toBe('contacts');
    expect(sections[1]?.querySelector('output')?.textContent).toBe('selection');

    fireEvent.click(screen.getByRole('button', { name: 'History first' }));
    expect(onFirstHistory).toHaveBeenCalledTimes(1);
    expect(onSecondHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tickets first' }));
    expect(onFirstTickets).toHaveBeenCalledTimes(1);
  });

  it('throws a configuration error when no data source is configured', () => {
    expect(() =>
      render(
        <TicketPurchaseProvider>
          <Probe label="missing source" />
        </TicketPurchaseProvider>,
      ),
    ).toThrow(/data source must be configured/i);
  });
});

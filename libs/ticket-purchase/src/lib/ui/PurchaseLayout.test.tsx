// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CSSProperties } from 'react';
import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import type { PurchaseDataSource } from '../model/purchase.types.js';
import { TicketPurchaseProvider } from '../TicketPurchaseProvider.js';
import { EventSummary } from './EventSummary.js';
import { PurchaseLayout } from './PurchaseLayout.js';
import { PurchaseStepper } from './PurchaseStepper.js';

const dataSource = {} as PurchaseDataSource;
const occurrence: BuyerOccurrenceSummary = {
  occurrenceId: 'occ-1',
  eventId: 'event-1',
  title: 'Billie Eilish',
  startsAt: '2026-09-04T20:00:00+04:00',
  timeZone: 'Asia/Yerevan',
  venue: { name: 'Дом камерной музыки имени Комитаса', city: 'Ереван' },
  poster: { url: 'https://example.test/poster.jpg', alt: 'Афиша Billie Eilish' },
  salesStatus: 'open',
  currency: 'AMD',
  capabilities: { seats: true, generalAdmission: true },
};

afterEach(cleanup);

describe('purchase shell', () => {
  it('shows API event data and calls details through the host callback', () => {
    const onDetails = vi.fn();
    const { container } = render(
      <EventSummary occurrence={occurrence} onDetails={onDetails} />,
    );

    expect(screen.getByRole('heading', { name: 'Billie Eilish' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Афиша Billie Eilish' })).toBeTruthy();
    expect(screen.getByText(/Дом камерной музыки имени Комитаса/)).toBeTruthy();
    expect(
      container.querySelector('.tp-event-summary__chevron')?.getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);
    fireEvent.click(screen.getByRole('button', { name: /подробнее о событии/i }));
    expect(onDetails).toHaveBeenCalledTimes(1);
  });

  it('marks the active checkout step accessibly', () => {
    render(<PurchaseStepper activeStep="payment" />);
    expect(screen.getByRole('navigation', { name: /этапы покупки/i })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /оплата/i }).getAttribute('aria-current')).toBe('step');
  });

  it('keeps step-specific selectors in the heading area before the responsive summary', () => {
    const { container } = render(
      <TicketPurchaseProvider dataSource={dataSource}>
        <PurchaseLayout
          occurrence={occurrence}
          headerContent={<div data-testid="step-controls">Date and hold timer</div>}
        >
          <div>Seat map slot</div>
        </PurchaseLayout>
      </TicketPurchaseProvider>,
    );

    const controls = container.querySelector('[data-testid="step-controls"]');
    const summary = container.querySelector('.tp-layout__summary');
    if (!controls || !summary) throw new Error('Expected both step controls and event summary');
    expect(
      Boolean(controls.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('keeps navigation scoped to host actions and exposes loading/error states', () => {
    const onBack = vi.fn();
    const { rerender, container } = render(
      <TicketPurchaseProvider dataSource={dataSource} hostActions={{ onBack }}>
        <PurchaseLayout occurrence={occurrence} loading>
          <p>Selection content</p>
        </PurchaseLayout>
      </TicketPurchaseProvider>,
    );

    expect(screen.getByRole('status').textContent).toMatch(/загрузка/i);
    expect(screen.queryByText('Selection content')).toBeNull();
    expect(container.querySelector('.tp-layout__back-icon')?.getAttribute('src')).toMatch(
      /^data:image\/svg\+xml/,
    );
    fireEvent.click(screen.getByRole('button', { name: /назад к мероприятию/i }));
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(
      <TicketPurchaseProvider dataSource={dataSource} hostActions={{ onBack }}>
        <PurchaseLayout occurrence={occurrence} error="Сеанс истёк">
          <p>Selection content</p>
        </PurchaseLayout>
      </TicketPurchaseProvider>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Сеанс истёк');
  });

  it('scopes per-widget theme variables to each widget root', () => {
    render(
      <div className="host-page" style={{ '--tp-color-accent': '#111111' } as CSSProperties}>
        <TicketPurchaseProvider dataSource={dataSource} theme={{ accent: '#bc2d9b' }}>
          <PurchaseLayout occurrence={occurrence}>
            <span>First</span>
          </PurchaseLayout>
        </TicketPurchaseProvider>
        <TicketPurchaseProvider dataSource={dataSource} theme={{ accent: '#306c4a' }}>
          <PurchaseLayout occurrence={occurrence}>
            <span>Second</span>
          </PurchaseLayout>
        </TicketPurchaseProvider>
      </div>,
    );

    const roots = document.querySelectorAll<HTMLElement>('[data-ticket-purchase-root]');
    expect(roots).toHaveLength(2);
    expect(roots[0]?.style.getPropertyValue('--tp-color-accent')).toBe('#bc2d9b');
    expect(roots[1]?.style.getPropertyValue('--tp-color-accent')).toBe('#306c4a');
    expect(document.querySelector<HTMLElement>('.host-page')?.style.getPropertyValue('--tp-color-accent')).toBe('#111111');
  });
});

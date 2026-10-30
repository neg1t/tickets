import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TicketPurchaseCompositionExample } from './TicketPurchaseCompositionExample.js';

afterEach(cleanup);

describe('TicketPurchaseCompositionExample', () => {
  it('composes two isolated widgets through package exports and keeps their theme scoped', () => {
    render(<TicketPurchaseCompositionExample />);

    const first = document.querySelector<HTMLElement>(
      '[data-ticket-purchase-instance="composition-music"]',
    );
    const second = document.querySelector<HTMLElement>(
      '[data-ticket-purchase-instance="composition-theater"]',
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first?.style.getPropertyValue('--tp-color-accent')).toBe('#bc2d9b');
    expect(second?.style.getPropertyValue('--tp-color-accent')).toBe('#306c4a');

    fireEvent.click(screen.getByRole('button', { name: 'Перейти к контактам: music' }));
    expect(first?.getAttribute('data-step')).toBe('contacts');
    expect(second?.getAttribute('data-step')).toBe('selection');
  });

  it('routes host navigation through callbacks without taking over host location', () => {
    const locationBefore = window.location.href;
    render(<TicketPurchaseCompositionExample />);
    fireEvent.click(screen.getByRole('button', { name: 'История: music' }));
    expect(window.location.href).toBe(locationBefore);
  });
});

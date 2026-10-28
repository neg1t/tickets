import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { EmbedPage } from '../index';

vi.mock('@hall-platform/seat-view', async () => {
  const React = await import('react');
  return {
    SeatView: (props: {
      layout: {
        hallName: string;
        snapshot: { seats: readonly unknown[] };
      };
      occurrenceId: string;
    }) =>
      React.createElement(
        'section',
        {
          'aria-label': `Места: ${props.layout.hallName}`,
          'data-seat-count': props.layout.snapshot.seats.length,
          'data-occurrence': props.occurrenceId,
        },
        React.createElement('div', { 'data-testid': 'hall-viewer' }),
        React.createElement('button', { type: 'button' }, 'Место демо'),
      ),
  };
});

describe('EmbedPage', () => {
  it('shows a working buyer view backed by a real hall fixture', () => {
    render(<EmbedPage />);

    expect(
      screen.getByRole('heading', { name: 'Бронирование мест' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Места: Small Theater' }),
    ).toBeTruthy();
    expect(screen.getByTestId('hall-viewer')).toBeTruthy();
    expect(
      screen
        .getByRole('region', { name: 'Места: Small Theater' })
        .getAttribute('data-seat-count'),
    ).not.toBe('0');
    expect(screen.getByRole('button', { name: 'Место демо' })).toBeTruthy();
  });
});

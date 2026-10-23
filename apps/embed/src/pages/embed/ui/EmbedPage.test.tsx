import { render, screen } from '@testing-library/react';

import { EmbedPage } from '../index';

describe('EmbedPage', () => {
  it('shows an empty state when no hall data is provided', () => {
    render(<EmbedPage />);

    expect(screen.getByRole('heading', { name: 'Схема зала' })).toBeTruthy();
    expect(screen.getByText('Пока нет данных для отображения.')).toBeTruthy();
  });
});

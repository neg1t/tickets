import { render, screen } from '@testing-library/react';
import { act } from 'react';

import { DashboardPage } from '../index';

// Canvas behavior is covered by the browser e2e test.
vi.mock('@hall-platform/renderer-konva', () => ({ HallViewer: () => null }));
vi.mock('@hall-platform/hall-editor', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  HallEditor: () => null,
}));

describe('DashboardPage', () => {
  it('shows the hall management dashboard', async () => {
    await act(async () => {
      render(<DashboardPage />);
    });

    expect(screen.getByRole('heading', { name: 'Hall Studio' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Мои залы' })).toBeTruthy();
  });
});

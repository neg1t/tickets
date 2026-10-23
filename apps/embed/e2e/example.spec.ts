import { test, expect } from '@playwright/test';

test('renders the empty hall state', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Схема зала' })).toBeVisible();
  await expect(page.getByText('Пока нет данных для отображения.')).toBeVisible();
});

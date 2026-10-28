import { test, expect } from '@playwright/test';

test('renders a buyer map from the public seat-view package', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Бронирование мест' }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Места: Small Theater' }),
  ).toBeVisible();
  await expect(
    page.locator('.hall-viewer-canvas canvas').first(),
  ).toBeVisible();
});

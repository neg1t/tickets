import { expect, test } from '@playwright/test';

test('catalog and editor use separate screens with a viewport-height canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible();
  await expect(page.locator('#hall-stage')).toHaveCount(0);

  await page
    .locator('.hall-card', { hasText: 'Small Theater' })
    .getByRole('button', { name: 'Открыть черновик' })
    .click();

  const stage = page.locator('#hall-stage');
  await expect(stage).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toHaveCount(0);
  const bounds = await stage.boundingBox();
  expect(bounds?.y).toBeLessThan(240);
  expect(bounds?.height).toBeGreaterThan(400);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'К списку залов' }).click();
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible();
  await expect(stage).toHaveCount(0);
});

test('catalog search and service menu keep destructive actions out of the primary toolbar', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Найти зал' }).fill('Arena');
  await expect(page.locator('.hall-card')).toHaveCount(1);
  await expect(page.locator('.hall-card')).toContainText('Arena');
  await page.getByRole('searchbox', { name: 'Найти зал' }).clear();

  await expect(
    page.getByRole('button', { name: 'Сбросить демо-данные' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Демо и обслуживание' }).click();
  await expect(
    page.getByRole('button', { name: 'Сбросить демо-данные' }),
  ).toBeVisible();
});

test('mobile catalog and buyer do not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Демо и обслуживание' }).click();
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  await expect(page.locator('.seat-view')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    )
    .toBe(true);
});

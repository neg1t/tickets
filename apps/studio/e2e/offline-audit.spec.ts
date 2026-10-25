import { expect, test } from '@playwright/test';

test('records that a fresh offline browser cannot cold-start Studio', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Base URL is required');
  const context = await browser.newContext();
  const page = await context.newPage();
  await context.setOffline(true);
  await expect(page.goto(baseURL)).rejects.toThrow();
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toHaveCount(0);
  await context.close();
});

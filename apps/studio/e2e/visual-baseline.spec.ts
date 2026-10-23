import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function capture(name: string, screenshot: Buffer) {
  await test
    .info()
    .attach(name, { body: screenshot, contentType: 'image/png' });
  if (process.env['HALL_CAPTURE_BASELINE'] === '1') {
    const directory = join(test.info().config.rootDir, 'baselines');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}.png`), screenshot);
  }
}

test('captures the desktop catalog baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await capture('studio-catalog-1280x800', await page.screenshot());
});

test('captures the desktop editor baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await expect(page.locator('#hall-stage')).toBeVisible();
  await page.locator('#hall-stage').scrollIntoViewIfNeeded();
  await capture('studio-editor-1280x800', await page.screenshot());
});

test('captures the mobile buyer baseline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  const buyer = page.getByRole('region', { name: /Места: Small Theater/ });
  await expect(buyer).toBeVisible();
  await buyer.scrollIntoViewIfNeeded();
  await capture('studio-buyer-390x844', await page.screenshot());
});

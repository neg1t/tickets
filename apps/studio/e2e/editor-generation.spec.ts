import { expect, test } from '@playwright/test';

test('previews and applies row and table seating in one undo step', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  const canvas = page.locator('.hall-viewer-canvas');
  const summary = page.locator('.hall-editor-header span');

  await page.getByRole('button', { name: 'Прямой ряд' }).click();
  await stage.click({ position: { x: 380, y: 250 } });
  await expect(summary).toContainText('8 мест');
  await page.getByLabel('Мест в ряду').fill('10');
  await expect(page.getByText('Предпросмотр: 10 мест')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-preview-seats', '10');
  await expect(summary).toContainText('8 мест');
  await page.getByRole('button', { name: 'Применить места' }).click();
  await expect(summary).toContainText('10 мест');
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(summary).toContainText('8 мест');

  await page.getByRole('button', { name: 'Круглый стол' }).click();
  await stage.click({ position: { x: 520, y: 350 } });
  await expect(summary).toContainText('14 мест');
  await page.getByLabel('Гостей за столом').fill('8');
  await expect(page.getByText('Предпросмотр: 8 мест')).toBeVisible();
  await page.getByRole('button', { name: 'Применить места' }).click();
  await expect(summary).toContainText('16 мест');
});

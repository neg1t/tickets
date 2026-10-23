import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openCatalogServices, openCurrentEditor } from './navigation';

test('A01: a dragged seat visibly moves before pointer release', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Выбор' }).click();
  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  const before = await stage.screenshot();
  await page.mouse.move(bounds.x + 450, bounds.y + 250, { steps: 4 });
  const during = await stage.screenshot();
  expect(during.equals(before)).toBe(false);
  await page.mouse.up();
});

test('A07: a dirty draft survives reload as a recoverable copy', async ({
  page,
}) => {
  test.fail(); // Remove when H06 adds recovery storage.
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await expect(page.getByText(/1 мест/)).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/1 мест/),
  ).toBeVisible();
});

test('A02: leaving the canvas does not commit an unfinished drag', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 250);
  await page.mouse.move(bounds.x - 20, bounds.y - 20);
  await expect(page.getByText('Изменений через onChange: 1')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText('Изменений через onChange: 2')).toBeVisible();
});

test('A05: deleting a multiselection removes both seats', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 450, y: 250 } });
  await stage.click({ position: { x: 400, y: 250 }, modifiers: ['Shift'] });
  await expect(page.getByText(/Выбрано: 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Удалить объект' }).click();
  await expect(page.getByText(/0 мест/)).toBeVisible();
});

test('A04: changing a row in the inspector updates its seats', async ({
  page,
}) => {
  await page.goto('/');
  await openCurrentEditor(page);
  const stage = page.locator('#hall-stage');
  const viewer = page.locator('.hall-viewer-canvas');
  const x = Number(await viewer.getAttribute('data-viewport-x'));
  const y = Number(await viewer.getAttribute('data-viewport-y'));
  const scale = Number(await viewer.getAttribute('data-viewport-scale'));
  await stage.click({ position: { x: x + scale, y: y + 10 * scale } });
  const startX = page.getByRole('spinbutton', { name: 'Начало X' });
  await expect(startX).toBeVisible();
  await startX.fill('-1');
  await startX.blur();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await downloadPromise).path(), 'utf8'),
  );
  const firstSeat = draft.snapshot.seats.find(
    (seat: { placement: { rowId?: string } }) =>
      seat.placement.rowId === 'small-theater-row-left-1',
  );
  expect(firstSeat.position.x).toBe(-1);
});

test('A06: oversized JSON is rejected before parsing it', async ({ page }) => {
  test.fail(); // Remove when H06 adds import limits.
  await page.goto('/');
  await openCatalogServices(page);
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'oversized.json',
    mimeType: 'application/json',
    buffer: Buffer.from(' '.repeat(21 * 1024 * 1024) + '{}'),
  });
  await expect(page.getByRole('alert').first()).toContainText(
    /размер|мб|size|large/i,
  );
});

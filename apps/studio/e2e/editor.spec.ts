import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openCurrentEditor } from './navigation';

test('renders a hall, zooms, pans and selects a seat', async ({ page }) => {
  await page.goto('/');
  await openCurrentEditor(page);

  const stage = page.locator('#hall-stage');
  await expect(stage).toBeVisible();
  expect((await stage.boundingBox())?.height).toBeGreaterThan(300);
  await expect(stage.locator('canvas')).toHaveCount(4);

  const viewer = page.locator('.hall-viewer-canvas');
  const initialScale = Number(await viewer.getAttribute('data-viewport-scale'));
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(initialScale);

  await page.getByRole('button', { name: 'Вписать' }).click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeCloseTo(initialScale, 1);

  const x = Number(await viewer.getAttribute('data-viewport-x'));
  const y = Number(await viewer.getAttribute('data-viewport-y'));
  const scale = Number(await viewer.getAttribute('data-viewport-scale'));
  await stage.click({ position: { x, y: y + 10 * scale } });
  await expect(page.getByText(/Выбрано: 1 — L1-1/)).toBeVisible();

  const updatedX = Number(await viewer.getAttribute('data-viewport-x'));
  const updatedY = Number(await viewer.getAttribute('data-viewport-y'));
  const updatedScale = Number(await viewer.getAttribute('data-viewport-scale'));
  await stage.click({
    position: {
      x: updatedX + 2 * updatedScale,
      y: updatedY + 10 * updatedScale,
    },
    modifiers: ['Shift'],
  });
  await expect(page.getByText(/Выбрано: 2 — L1-1, L1-2/)).toBeVisible();
  await page.getByRole('button', { name: 'К выбранному' }).click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(scale);

  await page.getByRole('button', { name: 'Вписать' }).click();

  await page.getByRole('button', { name: 'Рука' }).click();
  const box = await stage.evaluate((element) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  await page.mouse.move(box.x + 250, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 220, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-x')))
    .toBeGreaterThan(x);
});
test('keeps the cursor point fixed during wheel zoom and opens a zone', async ({
  page,
}) => {
  await page.goto('/');
  await openCurrentEditor(page);
  const stage = page.locator('#hall-stage');
  const viewer = page.locator('.hall-viewer-canvas');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.evaluate((element) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const anchor = { x: 350, y: 210 };
  const before = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  await page.mouse.move(box.x + anchor.x, box.y + anchor.y);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(before.scale);
  const after = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  expect(
    Math.abs(
      (anchor.x - after.x) / after.scale - (anchor.x - before.x) / before.scale,
    ),
  ).toBeLessThan(0.02);
  expect(
    Math.abs(
      (anchor.y - after.y) / after.scale - (anchor.y - before.y) / before.scale,
    ),
  ).toBeLessThan(0.02);

  await page
    .getByRole('combobox', { name: 'Приблизить зону' })
    .selectOption('small-theater-zone-left');
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(after.scale);
});
test('pinch gesture zooms the hall', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await openCurrentEditor(page);
  const viewer = page.locator('.hall-viewer-canvas');
  const stage = page.locator('#hall-stage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.evaluate((element) => {
    const rect = (element as HTMLElement).getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const centerX = box.x + 400;
  const centerY = box.y + 200;
  const initialScale = Number(await viewer.getAttribute('data-viewport-scale'));
  const client = await context.newCDPSession(page);

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 30, y: centerY, id: 1 },
      { x: centerX + 30, y: centerY, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 70, y: centerY, id: 1 },
      { x: centerX + 70, y: centerY, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });

  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(initialScale);
  await context.close();
});

test('a pinch can continue as a one-finger pan', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await openCurrentEditor(page);
  await page.getByRole('button', { name: /Рука/ }).click();
  const viewer = page.locator('.hall-viewer-canvas');
  const stage = page.locator('#hall-stage');
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing stage bounds for pinch transition');
  const centerX = bounds.x + Math.min(400, bounds.width / 2);
  const centerY = bounds.y + Math.min(200, bounds.height / 2);
  const initialScale = Number(await viewer.getAttribute('data-viewport-scale'));
  const client = await context.newCDPSession(page);

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 30, y: centerY, id: 1 },
      { x: centerX + 30, y: centerY, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 60, y: centerY, id: 1 },
      { x: centerX + 60, y: centerY, id: 2 },
    ],
  });
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(initialScale);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: centerX + 60, y: centerY, id: 2 }],
  });
  await expect(viewer).toHaveAttribute('data-pointer-mode', 'pan');
  const xAfterPinch = Number(await viewer.getAttribute('data-viewport-x'));
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: centerX - 20, y: centerY + 10, id: 1 }],
  });
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-x')))
    .not.toBe(xAfterPinch);

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await context.close();
});

test('creates and edits a new hall with undo, redo and save callback', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await expect(
    page.getByRole('region', { name: 'Редактор зала Новый зал' }),
  ).toBeVisible();
  const stage = page.locator('#hall-stage');

  await page.getByRole('button', { name: 'Зона', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await expect(page.getByText(/1 зон · 0 рядов/)).toBeVisible();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '1',
  );
  await page.getByRole('textbox', { name: 'Название зоны' }).fill('Партер');
  await page.getByRole('textbox', { name: 'Название зоны' }).blur();
  await expect(
    page
      .getByRole('combobox', { name: 'Зона для новых объектов' })
      .getByRole('option', { name: 'Партер' }),
  ).toBeAttached();

  await page.getByRole('button', { name: 'Прямой ряд' }).click();
  await stage.click({ position: { x: 400, y: 260 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 620, y: 350 } });
  await page.getByRole('spinbutton', { name: 'X места' }).fill('17.5');
  await page.getByRole('spinbutton', { name: 'X места' }).blur();
  await expect(page.getByRole('spinbutton', { name: 'X места' })).toHaveValue(
    '17.5',
  );
  await page.getByRole('button', { name: 'Круглый стол' }).click();
  await stage.click({ position: { x: 500, y: 300 } });
  await expect(
    page.getByText(/1 зон · 1 рядов · 15 мест · 1 столов/),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(
    page.getByText(/1 зон · 1 рядов · 9 мест · 0 столов/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(
    page.getByText(/1 зон · 1 рядов · 15 мест · 1 столов/),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved.snapshot.zones[0].name).toBe('Партер');
  expect(
    saved.snapshot.seats.find(
      (seat: { placement: { kind: string } }) =>
        seat.placement.kind === 'standalone',
    ).position.x,
  ).toBe(17.5);
  expect(saved.snapshot.tables).toHaveLength(1);
});

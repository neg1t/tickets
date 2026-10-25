import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type ExportedSeat = { id: string; position: { x: number; y: number } };

function seatAt(seats: readonly ExportedSeat[], index: number): ExportedSeat {
  const seat = seats[index];
  if (!seat) throw new Error(`Missing seat ${index}`);
  return seat;
}

async function exportSeats(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  return draft.snapshot.seats as ExportedSeat[];
}

test('moves two selected seats in one commit and one undo step', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 450, y: 250 } });
  const before = await exportSeats(page);
  await stage.click({ position: { x: 400, y: 250 }, modifiers: ['Shift'] });
  await expect(page.getByText(/Выбрано: 2/)).toBeVisible();

  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  const beforePreview = await stage.screenshot();
  await page.mouse.move(bounds.x + 425, bounds.y + 250, { steps: 5 });
  const duringPreview = await stage.screenshot();
  expect(duringPreview.equals(beforePreview)).toBe(false);
  await expect(page.getByText('Изменений через onChange: 2')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText('Изменений через onChange: 3')).toBeVisible();
  const moved = await exportSeats(page);
  expect(moved).toHaveLength(2);
  expect(
    seatAt(moved, 0).position.x - seatAt(before, 0).position.x,
  ).toBeCloseTo(seatAt(moved, 1).position.x - seatAt(before, 1).position.x);
  expect(seatAt(moved, 0).position.x).toBeGreaterThan(
    seatAt(before, 0).position.x,
  );

  await page.getByRole('button', { name: 'Отменить' }).click();
  expect(await exportSeats(page)).toEqual(before);
  await page.getByRole('button', { name: 'Повторить' }).click();
  expect(await exportSeats(page)).toEqual(moved);
});

test('Escape cancels a preview without changing the draft or history', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 250, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByText('Изменений через onChange: 1')).toBeVisible();
  expect(await exportSeats(page)).toEqual(before);
});

test('a tap and a zero-distance press do not create a move command', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  await stage.click({ position: { x: 400, y: 250 } });
  await expect(page.getByText(/Выбрано: 1/)).toBeVisible();
  await expect(page.getByText('Изменений через onChange: 1')).toBeVisible();
  expect(await exportSeats(page)).toEqual(before);
});

test('dragging at the edge pans the viewport without an intermediate commit', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const viewer = page.locator('.hall-viewer-canvas');
  const before = Number(await viewer.getAttribute('data-viewport-x'));
  const bounds = (await stage.boundingBox()) as {
    x: number;
    y: number;
    width: number;
  };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + 250, {
    steps: 8,
  });
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-x')))
    .toBeLessThan(before - 20);
  await expect(page.getByText('Изменений через onChange: 1')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText('Изменений через onChange: 2')).toBeVisible();
});

test('replacing the hall during a drag cancels the old document gesture', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Сохранено локально' }).first(),
  ).toBeVisible();
  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 250, { steps: 4 });
  await page.getByRole('button', { name: 'Демо и обслуживание' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page.getByRole('menuitem', { name: 'Открыть тестовый зал' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('.studio-editor-title strong')).toHaveText('Small Theater');
  await page.mouse.up();
  await expect(page.getByText('Изменений через onChange: 0')).toBeVisible();
});

test('touch pointercancel discards a drag without changing the saved geometry', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  await stage.scrollIntoViewIfNeeded();
  const beforeImage = await stage.screenshot();
  const box = (await stage.boundingBox()) as { x: number; y: number };
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 400, y: box.y + 250, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: box.x + 450, y: box.y + 250, id: 1 }],
  });
  expect((await stage.screenshot()).equals(beforeImage)).toBe(false);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await expect(page.getByText('Изменений через onChange: 1')).toBeVisible();
  expect(await exportSeats(page)).toEqual(before);
  await context.close();
});

test('pen movement commits a seat once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox()) as { x: number; y: number };
  const client = await page.context().newCDPSession(page);
  const point = { x: box.x + 400, y: box.y + 250 };
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'pen',
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x + 40,
    y: point.y,
    button: 'left',
    buttons: 1,
    pointerType: 'pen',
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x + 40,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'pen',
  });
  await expect(page.getByText('Изменений через onChange: 2')).toBeVisible();
  expect(seatAt(await exportSeats(page), 0).position.x).toBeGreaterThan(
    seatAt(before, 0).position.x,
  );
});

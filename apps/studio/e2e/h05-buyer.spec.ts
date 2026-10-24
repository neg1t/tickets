import { expect, test } from '@playwright/test';
import { openBuyer } from './navigation';

test('buyer list supports keyboard choice and keeps focus while filtering', async ({
  page,
}) => {
  await page.goto('/');
  await openBuyer(page);
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  const search = view.getByRole('searchbox', { name: 'Места' });
  await search.fill('L1-1');
  await expect(search).toBeFocused();
  await expect(view.getByRole('button', { name: /^Место L1-1/ })).toBeVisible();
  await view.getByRole('button', { name: /^Место L1-1/ }).focus();
  await page.keyboard.press('Enter');
  await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
  const details = view.getByRole('region', { name: 'Информация о месте' });
  await expect(details).toContainText('Small Theater');
  await expect(details).toContainText('Left sector');
  await expect(details).toContainText('Ряд');
  await page.screenshot({
    path: 'apps/studio/test-output/h05-buyer-desktop.png',
    fullPage: true,
  });
});

test('buyer can switch the checkout and seat controls to English', async ({
  page,
}) => {
  await page.goto('/');
  await openBuyer(page);
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Choose tickets', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seat selection' })).toBeVisible();
  const view = page.getByRole('region', { name: /Seats: Small Theater/ });
  await expect(view.getByRole('searchbox', { name: 'Seats' })).toBeVisible();
  await view.getByRole('button', { name: /^Seat L1-1/ }).click();
  await view.getByRole('button', { name: 'Buy' }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirm purchase' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm purchase' }),
  ).toBeVisible();
});

test('touch tap selects a seat, pinch zooms and mobile basket stays reachable at 360px', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await openBuyer(page);
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  const canvas = view.locator('.hall-viewer-canvas');
  const stage = view.locator('[id^="seat-stage-"]');
  const box = await stage.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const x = Number(await canvas.getAttribute('data-viewport-x'));
  const y = Number(await canvas.getAttribute('data-viewport-y'));
  const scale = Number(await canvas.getAttribute('data-viewport-scale'));
  await page.touchscreen.tap(box.x + x, box.y + y + 10 * scale);
  await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(scale);
  const basket = view.locator('.seat-view-basket');
  await expect(basket.getByRole('button', { name: 'Купить' })).toBeVisible();
  const basketBox = await basket.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { y: rect.y, height: rect.height };
  });
  expect(basketBox.y).toBeGreaterThan(0);
  expect(basketBox.y + basketBox.height).toBeLessThanOrEqual(801);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'apps/studio/test-output/h05-buyer-mobile.png',
    fullPage: true,
  });

  const client = await context.newCDPSession(page);
  const selectedScale = Number(
    await canvas.getAttribute('data-viewport-scale'),
  );
  const centerX = box.x + 160;
  const centerY = box.y + 150;
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 20, y: centerY, id: 1 },
      { x: centerX + 20, y: centerY, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 55, y: centerY, id: 1 },
      { x: centerX + 55, y: centerY, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(selectedScale);
  await context.close();
});

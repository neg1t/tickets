import { expect, test } from '@playwright/test';
import { openBuyer } from './navigation';

test('catalog and buyer remain keyboard navigable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible();
  await expect(
    page.locator('nav[aria-label="Основная навигация"]'),
  ).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Покупательская схема' }),
  ).toBeVisible();
  await openBuyer(page);
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  const search = view.getByRole('searchbox', { name: 'Места' });
  await search.fill('L1-1');
  await expect(search).toBeFocused();
  const seat = view.getByRole('button', { name: /^Место L1-1/ });
  await seat.focus();
  await page.keyboard.press('Enter');
  await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
  await expect(
    view.getByRole('region', { name: 'Информация о месте' }),
  ).toContainText('Left sector');
});

test('mobile buyer keeps actions inside the viewport and supports touch', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'mobile-chromium');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await openBuyer(page);
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  const seat = view.getByRole('button', { name: /^Место L1-1/ });
  await seat.scrollIntoViewIfNeeded();
  const box = await seat.boundingBox();
  if (!box) throw new Error('Seat control has no bounds');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
  const basket = view.locator('.seat-view-basket');
  await expect(basket.getByRole('button', { name: 'Купить' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const basketBox = await basket.boundingBox();
  if (!basketBox) throw new Error('Basket has no bounds');
  expect(basketBox.x).toBeGreaterThanOrEqual(0);
  expect(basketBox.x + basketBox.width).toBeLessThanOrEqual(361);
  await test.info().attach('mobile-buyer', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('buyer can select and cancel tickets with keyboard across target widths', async ({
  page,
}) => {
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.goto('/');
    await openBuyer(page);
    const view = page.getByRole('region', { name: /Места: Small Theater/ });
    await view.getByRole('button', { name: /^Место L1-1/ }).click();
    await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
    const buy = view
      .locator('.seat-view-basket')
      .getByRole('button', { name: 'Купить' });
    await buy.focus();
    await expect(buy).toBeFocused();
    const box = await buy.boundingBox();
    if (!box) throw new Error(`Purchase action has no bounds at ${width}px`);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(width < 500 ? 845 : 901);

    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Подтверждение покупки' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(
      view.getByRole('button', { name: /^Место L1-1 — доступно/ }),
    ).toBeEnabled();
  }
});

test('mobile buyer keeps seat details and basket usable at 200 percent text size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto('/');
  await openBuyer(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  await view.getByRole('button', { name: /^Место L1-1/ }).click();
  await expect(
    view.getByRole('region', { name: 'Информация о месте' }),
  ).toContainText('L1-1');
  const basket = view.locator('.seat-view-basket');
  await expect(basket.getByRole('button', { name: 'Купить' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

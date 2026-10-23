import { test, expect } from '@playwright/test';

test('books a seat locally and persists its sold status after reload without HTTP', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      return route.continue();
    externalRequests.push(url.href);
    return route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  await expect(
    page.getByRole('heading', { name: 'Покупательская схема' }),
  ).toBeVisible();
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  await view.getByRole('button', { name: /Место L1-1/ }).click();
  await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
  await view.getByRole('button', { name: 'Купить' }).click();
  await expect(
    page.getByRole('heading', { name: 'Подтверждение покупки' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить покупку' }).click();
  await expect(
    page.getByRole('heading', { name: 'Покупка подтверждена' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  await expect(
    page.getByRole('button', { name: /Место L1-1 — продано/ }),
  ).toBeDisabled();
  expect(externalRequests).toEqual([]);
});
test('shows four demo events and releases a cancelled hold', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await expect(page.locator('.demo-events article')).toHaveCount(4);
  await page
    .locator('.demo-events article', { hasText: 'Small Theater' })
    .getByRole('button', { name: 'Выбрать билеты' })
    .click();
  const view = page.locator('.seat-view');
  const availableSeat = view.getByRole('button', { name: /^Место L1-1/ });
  await availableSeat.click();
  await view.getByRole('button', { name: 'Купить' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(
    view.getByRole('button', { name: /^Место L1-1 — доступно/ }),
  ).toBeEnabled();
});
test('SeatView accepts canvas selection and fits a narrow mobile screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  const view = page.getByRole('region', { name: /Места: Small Theater/ });
  const canvas = view.locator('.hall-viewer-canvas');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const x = Number(await canvas.getAttribute('data-viewport-x'));
  const y = Number(await canvas.getAttribute('data-viewport-y'));
  const scale = Number(await canvas.getAttribute('data-viewport-scale'));
  await view.locator('[id^="seat-stage-"]').click({
    position: { x, y: y + 10 * scale },
  });
  await expect(view.getByText('Выбрано: 1', { exact: true })).toBeVisible();
  await view
    .getByRole('combobox', { name: 'Все сектора' })
    .selectOption('small-theater-zone-left');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(scale);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});
test('SeatView switches floors without carrying another floor into its seat list', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .locator('.hall-card', { hasText: 'Opera Hall' })
    .getByRole('button', { name: 'Открыть черновик' })
    .click();
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  const view = page.getByRole('region', { name: /Места: Opera Hall/ });
  await view
    .getByRole('combobox', { name: 'Этаж' })
    .last()
    .selectOption('opera-hall-floor-upper');
  await expect(view.getByRole('button', { name: /Место B1/ })).toBeVisible();
  await expect(view.getByRole('button', { name: /Место 1-1/ })).toHaveCount(0);
  await expect(
    view.getByRole('combobox', { name: 'Этаж' }).first(),
  ).toHaveValue('opera-hall-floor-upper');
});

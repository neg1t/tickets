import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeTwoPagePdf } from './pdfFixture';

test('renders the hall management dashboard', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Hall Studio' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible();
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await expect(
    page.locator('.hall-card').filter({ hasText: 'Опубликована версия 1' }),
  ).toHaveCount(4);
});

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

test('saves a draft in IndexedDB and restores it after reload without network access', async ({
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
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await expect(page.getByText(/1 мест/)).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено локально')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/1 мест/),
  ).toBeVisible();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  await expect(
    page.locator('.hall-card', { hasText: 'Новый зал' }),
  ).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('keeps a published version unchanged while the draft is edited', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await expect(
    page.getByText('Опубликована версия 1', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 460, y: 250 } });
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/2 мест/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Версия 1' }).click();
  await expect(
    page.getByRole('heading', { name: 'Опубликованная схема' }),
  ).toBeVisible();
  await expect(page.getByText('Опубликовано: 1 мест')).toBeVisible();

  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/2 мест/),
  ).toBeVisible();
});

test('copies halls and resets local demo data to the four fixtures', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.hall-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Создать копию' }).click();
  await expect(page.getByText('Текущий зал: Новый зал (копия)')).toBeVisible();
  await expect(page.locator('.hall-card')).toHaveCount(6);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Сбросить демо-данные' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await expect(
    page.locator('.hall-card', { hasText: 'Новый зал' }),
  ).toHaveCount(0);
});

test('keeps an imported PDF and seat coordinates after local save and reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByLabel('Загрузить PDF').setInputFiles({
    name: 'local-plan.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(),
  });
  await expect(page.getByText('Подложка: отображается')).toBeVisible();
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const before = JSON.parse(
    await readFile(await (await firstDownload).path(), 'utf8'),
  );

  await page.reload();
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await expect(page.getByText('local-plan.pdf · 2 страницы')).toBeVisible();
  await expect(page.getByText('Подложка: отображается')).toBeVisible();
  const secondDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const after = JSON.parse(
    await readFile(await (await secondDownload).path(), 'utf8'),
  );
  expect(after.snapshot.seats[0].position).toEqual(
    before.snapshot.seats[0].position,
  );
  expect(after.snapshot.backgrounds[0]).toEqual(before.snapshot.backgrounds[0]);
});

test('rejects stale save and publication from another tab', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.locator('.hall-card')).toHaveCount(4);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('.hall-card')).toHaveCount(4);
  await first.getByRole('button', { name: 'Редактор', exact: true }).click();
  await second.getByRole('button', { name: 'Редактор', exact: true }).click();

  await first.getByRole('button', { name: 'Место', exact: true }).click();
  await first.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await first.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(first.getByText('Сохранено локально')).toBeVisible();

  await second.getByRole('button', { name: 'Место', exact: true }).click();
  await second.locator('#hall-stage').click({ position: { x: 450, y: 250 } });
  await second.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(second.getByRole('alert').first()).toContainText(
    'Черновик изменён в другой вкладке',
  );
  await second.getByRole('button', { name: 'Опубликовать' }).click();
  await expect(second.getByRole('alert').first()).toContainText(
    'Черновик изменён в другой вкладке',
  );
  await expect(second.getByRole('button', { name: 'Версия 2' })).toHaveCount(0);
  await context.close();
});

test('keeps a draft when switching halls is cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Открыть тестовый зал' }).click();
  await expect(page.getByText('Текущий зал: Новый зал')).toBeVisible();
  await expect(page.getByText(/1 мест/)).toBeVisible();
});

test('restores a modified fixture and retains its older publication', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  const modified = await page.locator('.hall-card').first().textContent();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Восстановить примеры' }).click();
  await expect(page.getByRole('button', { name: 'Версия 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Версия 1' })).toBeVisible();
  await expect(page.locator('.hall-card').first()).not.toHaveText(
    modified ?? '',
  );
});

test('deleting a hall retains its published snapshot', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Опубликовать' }).click();
  await expect(page.getByRole('button', { name: 'Версия 1' })).toBeVisible();
  const hallId = await page.evaluate(() =>
    localStorage.getItem('hall-platform-active-hall'),
  );
  expect(hallId).not.toBeNull();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Удалить зал' }).click();
  await expect(page.getByText('Текущий зал: Новый зал')).toHaveCount(0);
  const versions = await page.evaluate(async (id) => {
    const request = indexedDB.open('hall-platform-studio');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<number>((resolve, reject) => {
      const transaction = database.transaction('versions', 'readonly');
      const count = transaction
        .objectStore('versions')
        .index('hallId')
        .count(id);
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  }, hallId ?? '');
  expect(versions).toBe(1);
});

test('renders a hall, zooms, pans and selects a seat', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('#hall-stage');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveCSS('height', '500px');
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

  await stage.click({
    position: { x: x + 2 * scale, y: y + 10 * scale },
    modifiers: ['Shift'],
  });
  await expect(page.getByText(/Выбрано: 2 — L1-1, L1-2/)).toBeVisible();
  await page.getByRole('button', { name: 'К выбранному' }).click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(scale);

  await page.getByRole('button', { name: 'Вписать' }).click();

  await page.getByRole('button', { name: 'Перемещение' }).click();
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
  await expect(page.getByText('Изменений через onChange: 1')).toBeVisible();
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
  await stage.click({ position: { x: 440, y: 260 } });
  await page.getByRole('spinbutton', { name: 'X места' }).fill('17.5');
  await page.getByRole('spinbutton', { name: 'X места' }).blur();
  await expect(page.getByRole('spinbutton', { name: 'X места' })).toHaveValue(
    '17.5',
  );
  await page.getByRole('button', { name: 'Круглый стол' }).click();
  await stage.click({ position: { x: 500, y: 300 } });
  await expect(
    page.getByText(/1 зон · 1 рядов · 1 мест · 1 столов/),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(
    page.getByText(/1 зон · 1 рядов · 1 мест · 0 столов/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(
    page.getByText(/1 зон · 1 рядов · 1 мест · 1 столов/),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved.snapshot.zones[0].name).toBe('Партер');
  expect(saved.snapshot.seats[0].position.x).toBe(17.5);
  expect(saved.snapshot.tables).toHaveLength(1);
});

test('imports a PDF, draws over page two, calibrates, and reopens the same geometry', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByLabel('Загрузить PDF').setInputFiles({
    name: 'plan.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(),
  });
  await expect(page.getByText('plan.pdf · 2 страницы')).toBeVisible();
  await page.getByRole('combobox', { name: 'Страница PDF' }).selectOption('2');
  await expect(page.getByText('Подложка: отображается')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Масштаб подложки' }).fill('0.5');
  await page.getByRole('spinbutton', { name: 'Масштаб подложки' }).blur();
  await page
    .getByRole('spinbutton', { name: 'Поворот подложки (°)' })
    .fill('30');
  await page.getByRole('spinbutton', { name: 'Поворот подложки (°)' }).blur();
  await page.getByRole('checkbox', { name: 'Заблокирована' }).check();
  await expect(
    page.getByRole('spinbutton', { name: 'Масштаб подложки' }),
  ).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Заблокирована' }).uncheck();
  await page.getByRole('button', { name: 'Вписать' }).click();

  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/1 мест/),
  ).toBeVisible();
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-visible-seats',
    'true',
  );

  await page
    .getByRole('spinbutton', { name: 'Известное расстояние (мм)' })
    .fill('1000');
  await page.getByRole('button', { name: 'Калибровать' }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await stage.click({ position: { x: 500, y: 250 } });
  await expect(page.getByText(/Калибровка: .* мм\/ед/)).toBeVisible();

  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const saved = JSON.parse(
    await readFile(await (await firstDownload).path(), 'utf8'),
  );
  expect(saved.snapshot.backgrounds[0].source.pageNumber).toBe(2);
  expect(saved.snapshot.backgrounds[0].scale).toBe(0.5);
  expect(saved.snapshot.backgrounds[0].rotationRadians).toBeCloseTo(
    Math.PI / 6,
  );
  expect(saved.calibration.millimetersPerWorldUnit).toBeGreaterThan(0);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await expect(page.getByText(/0 мест · 0 столов/)).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.hall-viewer-canvas')
          .getAttribute('data-viewport-scale'),
      ),
    )
    .toBeGreaterThan(10);
  const emptyScale = Number(
    await page
      .locator('.hall-viewer-canvas')
      .getAttribute('data-viewport-scale'),
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/1 мест/),
  ).toBeVisible();
  await expect(page.getByText('plan.pdf · 2 страницы')).toBeVisible();
  await expect(page.getByText('Подложка: отображается')).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.hall-viewer-canvas')
          .getAttribute('data-viewport-scale'),
      ),
    )
    .toBeLessThan(emptyScale / 2);
  const secondDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const reopened = JSON.parse(
    await readFile(await (await secondDownload).path(), 'utf8'),
  );
  expect(reopened.snapshot.seats[0].position).toEqual(
    saved.snapshot.seats[0].position,
  );
  expect(reopened.snapshot.backgrounds[0]).toEqual(
    saved.snapshot.backgrounds[0],
  );
  expect(reopened.calibration).toEqual(saved.calibration);
});

test('replaces a PDF and restores the previous page with undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByLabel('Загрузить PDF').setInputFiles({
    name: 'original.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(),
  });
  await page.getByRole('combobox', { name: 'Страница PDF' }).selectOption('2');
  await expect(page.getByText('Подложка: отображается')).toBeVisible();

  await page.getByLabel('Заменить PDF').setInputFiles({
    name: 'replacement.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(600),
  });
  await expect(page.getByText('replacement.pdf · 2 страницы')).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Страница PDF' }),
  ).toHaveValue('1');
  await expect(page.getByText('Подложка: отображается')).toBeVisible();
  const replacementDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const replaced = JSON.parse(
    await readFile(await (await replacementDownload).path(), 'utf8'),
  );
  const assetId = replaced.snapshot.backgrounds[0].source.assetId;
  expect(replaced.assets[assetId].pages[1].width).toBe(600);

  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.getByText('original.pdf · 2 страницы')).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Страница PDF' }),
  ).toHaveValue('2');
  await expect(page.getByText('Подложка: отображается')).toBeVisible();
  const originalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const restored = JSON.parse(
    await readFile(await (await originalDownload).path(), 'utf8'),
  );
  expect(restored.assets[assetId].pages[1].width).toBe(300);
});

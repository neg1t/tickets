import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openCatalogServices, openCurrentEditor, openEditorServices } from './navigation';
import { chooseEditorAction } from './navigation';

test('renders the hall management dashboard', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByText('Hall Studio', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible();
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await expect(
    page.locator('.hall-card').filter({ hasText: 'Опубликована версия 1' }),
  ).toHaveCount(4);
});

test('imports a v1 draft and exports the current schema version', async ({
  page,
}) => {
  await page.goto('/');
  const legacy = {
    hallName: 'Мигрированный зал',
    snapshot: {
      id: 'snapshot-legacy-import',
      layoutVersionId: 'version-legacy-import',
      floors: [
        {
          id: 'floor-legacy-import',
          layoutVersionId: 'version-legacy-import',
          name: 'Основной этаж',
        },
      ],
      zones: [],
      rows: [],
      seats: [],
      tables: [],
      backgrounds: [],
    },
    zoneBounds: {},
    assets: {},
    calibration: null,
  };
  await openCatalogServices(page);
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'legacy-hall.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(
    page.getByRole('region', { name: 'Редактор зала Мигрированный зал' }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(readFileSync(String(path), 'utf8')) as {
    schemaVersion: number;
    snapshot: { id: string };
  };
  expect(exported.schemaVersion).toBe(2);
  expect(exported.snapshot.id).toBe(legacy.snapshot.id);
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
  await openCurrentEditor(page);
  await expect(
    page
      .getByRole('region', { name: 'Редактор зала Новый зал' })
      .getByText(/1 мест/),
  ).toBeVisible();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  await page.getByRole('button', { name: 'К списку залов' }).click();
  await expect(page.locator('.hall-card', { hasText: 'Новый зал' })).toBeVisible();
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
    page.getByText('Опубликованная схема', { exact: true }),
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
  await page.getByRole('button', { name: 'К списку залов' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(5);
  await openCatalogServices(page);
  await page.getByRole('button', { name: 'Создать копию' }).click();
  await expect(page.locator('.hall-card', { hasText: 'Новый зал (копия)' })).toBeVisible();
  await expect(page.locator('.hall-card')).toHaveCount(6);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Сбросить демо-данные' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await expect(
    page.locator('.hall-card', { hasText: 'Новый зал' }),
  ).toHaveCount(0);
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
  await openCurrentEditor(first);
  await openCurrentEditor(second);

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
  await chooseEditorAction(page, 'Открыть тестовый зал');
  await expect(page.locator('.studio-editor-title strong')).toHaveText('Новый зал');
  await expect(page.getByText(/1 мест/)).toBeVisible();
});
test('restores a modified fixture and retains its older publication', async ({
  page,
}) => {
  await page.goto('/');
  await openCurrentEditor(page);
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено локально')).toBeVisible();
  await page.getByRole('button', { name: 'К списку залов' }).click();
  const modified = await page.locator('.hall-card').first().textContent();
  await openCatalogServices(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Восстановить примеры' }).click();
  await expect(page.locator('.hall-card').first()).not.toHaveText(
    modified ?? '',
  );
  await openCurrentEditor(page);
  await expect(page.getByRole('button', { name: 'Версия 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Версия 1' })).toBeVisible();
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
  await openEditorServices(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Удалить зал' }).click();
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

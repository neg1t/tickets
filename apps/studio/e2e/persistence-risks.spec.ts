import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeTwoPagePdf } from './pdfFixture';
import { chooseEditorAction } from './navigation';

test('R03: a PDF finishing after hall switch cannot enter the new hall', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        setTimeout(() => read.call(this).then(resolve, reject), 1200);
      });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByLabel('Загрузить PDF').setInputFiles({
    name: 'slow.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await chooseEditorAction(page, 'Открыть тестовый зал');
  await expect(page.locator('.studio-editor-title strong')).toHaveText('Small Theater');
  await page.waitForTimeout(1500);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await downloadPromise).path(), 'utf8'),
  );
  expect(draft.snapshot.backgrounds).toHaveLength(0);
});

test('R03: deleting a PDF during replacement does not restore it', async ({
  page,
}) => {
  test.fail(); // Remove when H06 cancels stale PDF import results.
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        setTimeout(() => read.call(this).then(resolve, reject), 800);
      });
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByLabel('Загрузить PDF').setInputFiles({
    name: 'first.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(),
  });
  await expect(page.getByText('first.pdf · 2 страницы')).toBeVisible();
  await page.getByLabel('Заменить PDF').setInputFiles({
    name: 'replacement.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(600),
  });
  await page.getByRole('button', { name: 'Удалить подложку' }).click();
  await page.waitForTimeout(1100);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await downloadPromise).path(), 'utf8'),
  );
  expect(draft.snapshot.backgrounds).toHaveLength(0);
  expect(Object.keys(draft.assets)).toHaveLength(0);
});

test('R05: one corrupted hall record does not hide healthy halls', async ({
  page,
}) => {
  test.fail(); // Remove when H06 adds record quarantine and recovery.
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.evaluate(async () => {
    const id = localStorage.getItem('hall-platform-active-hall');
    if (!id) throw new Error('Missing active hall');
    const request = indexedDB.open('hall-platform-studio');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('halls', 'readwrite');
      transaction.objectStore('halls').put({
        id,
        draft: { hallName: 'corrupted' },
        revision: 0,
        updatedAt: new Date().toISOString(),
        publishedVersionNumber: 0,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.locator('.hall-card')).toHaveCount(3);
});

test('R06: failed demo reset leaves the saved hall intact', async ({
  page,
}) => {
  test.fail(); // Remove when H06 makes reset recoverable across both databases.
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.hall-card')).toHaveCount(5);
  await page.evaluate(() => {
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function () {
      if (this.name === 'occurrences')
        throw new Error('injected demo clear failure');
      return clear.call(this);
    };
  });
  page.once('dialog', (dialog) => dialog.accept());
  await chooseEditorAction(page, 'Сбросить демо-данные');
  await expect(page.getByRole('alert').first()).toContainText(
    'injected demo clear failure',
  );
  await page.reload();
  await expect(
    page.locator('.hall-card', { hasText: 'Новый зал' }),
  ).toBeVisible();
});

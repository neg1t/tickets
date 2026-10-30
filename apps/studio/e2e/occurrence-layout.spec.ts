import { expect, test } from '@playwright/test';
import { makeTwoPagePdf } from './pdfFixture';

async function readUneditedRecords(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const open = (name: string, version: number) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const bookingDb = await open('hall-platform-demo-booking', 3);
    const occurrences = await read(bookingDb.transaction('occurrences', 'readonly').objectStore('occurrences').getAll());
    bookingDb.close();
    const selected = occurrences.find((record) => String(record.title).includes('Small Theater'));
    if (!selected) throw new Error('Seeded demo occurrence was not stored');

    const hallDb = await open('hall-platform-studio', 4);
    const hall = await read(hallDb.transaction('halls', 'readonly').objectStore('halls').get(selected.hallId));
    hallDb.close();
    return {
      selectedId: selected.id,
      otherOccurrences: occurrences.filter((record) => record.id !== selected.id),
      hall,
    };
  });
}

test('edits and saves a layout copy for one demo occurrence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  const event = page.locator('.demo-events article', { hasText: 'Small Theater' });
  await event.getByRole('button', { name: 'Настроить цены' }).click();
  await expect(page.getByRole('heading', { name: /Настройка цен/ })).toBeVisible();
  const before = await readUneditedRecords(page);

  await page.getByRole('button', { name: 'Редактировать схему мероприятия' }).click();
  const editor = page.getByRole('region', { name: /Редактор зала/ });
  await expect(editor.getByRole('button', { name: 'Опубликовать' })).toHaveCount(0);
  await page.getByLabel('Загрузить PDF').setInputFiles({
    name: 'occurrence-plan.pdf',
    mimeType: 'application/pdf',
    buffer: makeTwoPagePdf(),
  });
  await expect(page.getByText('occurrence-plan.pdf · 2 страницы')).toBeVisible();
  await editor.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 400, y: 250 } });
  await expect(editor.getByText(/мест/).first()).toBeVisible();
  const editorSummary = editor.locator('header').getByText(/^Черновик/);
  const summaryAfterAdd = await editorSummary.textContent();
  await page.getByRole('button', { name: 'Скрыть редактор' }).click();
  await page.getByRole('button', { name: 'Редактировать схему мероприятия' }).click();
  await editor.getByRole('button', { name: /Отменить/ }).click();
  await expect(editorSummary).not.toHaveText(summaryAfterAdd ?? '');
  await editor.getByRole('button', { name: /Повторить/ }).click();
  await expect(editorSummary).toHaveText(summaryAfterAdd ?? '');
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать схему мероприятия' })).toBeVisible();
  const after = await readUneditedRecords(page);
  expect(after.selectedId).toBe(before.selectedId);
  expect(after.otherOccurrences).toEqual(before.otherOccurrences);
  expect(after.hall).toEqual(before.hall);

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hall-platform-demo-booking', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['occurrences', 'occurrenceEditorMaterials'], 'readonly');
    const [occurrences, allMaterials] = await Promise.all([
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = transaction.objectStore('occurrences').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = transaction.objectStore('occurrenceEditorMaterials').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    ]);
    database.close();
    const occurrence = occurrences.find((record) => String(record.title).includes('Small Theater'));
    if (!occurrence) throw new Error('Seeded demo occurrence was not stored');
    const materials = allMaterials.find((record) => record.occurrenceId === occurrence.id);
    if (!materials) throw new Error('Occurrence editor materials were not stored');
    const assets = Object.values(materials.assets as Record<string, { dataUrl: string }>);
    return {
      inlineEditorLayout: Object.hasOwn(occurrence, 'editorLayout'),
      buyerBackgroundCount: (occurrence.layout as { snapshot: { backgrounds: unknown[] } }).snapshot.backgrounds.length,
      storedBackgroundCount: (materials.backgrounds as unknown[]).length,
      blobCount: Object.values(materials.blobs as Record<string, unknown>).filter((blob) => blob instanceof Blob).length,
      references: assets.map((asset) => asset.dataUrl),
    };
  });
  expect(stored.inlineEditorLayout).toBe(false);
  expect(stored.buyerBackgroundCount).toBe(0);
  expect(stored.storedBackgroundCount).toBe(1);
  expect(stored.blobCount).toBe(1);
  expect(stored.references[0]).toMatch(/^asset:sha256:/);

  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  await expect(page.getByRole('heading', { name: 'Покупательская схема' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await page.locator('.demo-events article', { hasText: 'Small Theater' })
    .getByRole('button', { name: 'Настроить цены' })
    .click();
  await page.getByRole('button', { name: 'Редактировать схему мероприятия' }).click();
  await expect(page.getByText('occurrence-plan.pdf · 2 страницы')).toBeVisible();
  await expect(page.getByRole('region', { name: /Редактор зала/ }).getByText(/мест/).first()).toBeVisible();
});

test('rejects a stale occurrence revision without discarding the editor draft', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await page.locator('.demo-events article', { hasText: 'Small Theater' })
    .getByRole('button', { name: 'Настроить цены' })
    .click();
  await expect(page.getByRole('heading', { name: /Настройка цен/ })).toBeVisible();
  const baseline = await readUneditedRecords(page);
  await page.getByRole('button', { name: 'Редактировать схему мероприятия' }).click();
  const editor = page.getByRole('region', { name: /Редактор зала/ });
  await editor.getByRole('button', { name: 'Место', exact: true }).click();
  await page.locator('#hall-stage').click({ position: { x: 420, y: 270 } });

  await page.evaluate(async (occurrenceId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hall-platform-demo-booking', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('occurrences', 'readwrite');
    const store = transaction.objectStore('occurrences');
    const request = store.get(occurrenceId);
    request.onsuccess = () => store.put({ ...request.result, revision: request.result.revision + 1 });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, baseline.selectedId);

  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(editor.getByText('Данные мероприятия изменились в другой вкладке', { exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
});

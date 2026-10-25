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
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Small Theater',
  );
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

test('R01: a delayed JSON import does not save after switching halls', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    File.prototype.text = function () {
      return new Promise<string>((resolve, reject) => {
        setTimeout(() => read.call(this).then(resolve, reject), 900);
      });
    };
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  draft.snapshot.id = `hall-${crypto.randomUUID()}`;
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'slow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  const otherName = await page.locator('.hall-card h2').nth(1).textContent();
  await page
    .locator('.hall-card')
    .nth(1)
    .getByRole('button', { name: 'Открыть черновик' })
    .click();
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    otherName ?? '',
  );
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'К списку залов' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(4);
});

test('R05: one corrupted hall record does not hide healthy halls', async ({
  page,
}) => {
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

test('R05: the catalog remains usable when browser storage access is denied', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('storage denied');
    };
    Storage.prototype.setItem = () => {
      throw new Error('storage denied');
    };
    Storage.prototype.removeItem = () => {
      throw new Error('storage denied');
    };
  });
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await page.getByRole('button', { name: 'Выбрать билеты' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Покупательская схема' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: /^Место .*доступно/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Купить' }).click();
  await expect(
    page.getByRole('heading', { name: 'Подтверждение покупки' }),
  ).toBeVisible();
});

test('R05: denied browser storage getters do not prevent catalog loading', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('localStorage denied');
      },
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('sessionStorage denied');
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await expect(page.locator('.demo-events .hall-card')).toHaveCount(4);
});

test('R05: a corrupt demo occurrence is replaced without hiding healthy events', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await expect(page.locator('.demo-events .hall-card')).toHaveCount(4);
  await page.evaluate(async () => {
    const request = indexedDB.open('hall-platform-demo-booking');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('occurrences', 'readwrite');
      const store = transaction.objectStore('occurrences');
      const records = store.getAll();
      records.onsuccess = () => {
        const first = records.result[0] as { id: string } | undefined;
        if (!first) throw new Error('Missing demo occurrence');
        store.put({ id: first.id, layout: null });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await expect(page.locator('.demo-events .hall-card')).toHaveCount(4);
});

test('R04: a temporary database failure offers a working retry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    let first = true;
    indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
      if (first) {
        first = false;
        throw new Error('temporary database failure');
      }
      return open(...args);
    }) as typeof indexedDB.open;
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Повторить загрузку' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(4);
});

test('A07: an unsaved hall can be recovered after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Копия черновика сохранена' }),
  ).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Восстановить черновик' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить черновик' }).click();
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Новый зал',
  );
});

test('H06: a portable hall package restores a deleted hall', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт пакета' }).click();
  const packageFile = await readFile(await (await download).path());
  await page.getByRole('button', { name: 'К списку залов' }).click();
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Удалить зал' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.getByLabel('Открыть пакет').setInputFiles({
    name: 'hall-package.json',
    mimeType: 'application/json',
    buffer: packageFile,
  });
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Новый зал',
  );
  await page.getByRole('button', { name: 'К списку залов' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(5);
});

test('H06: package import rejects a publication ID collision without changing another hall', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт пакета' }).click();
  const value = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  const originalHallId = value.hall.id;
  const otherHallId = `hall-${crypto.randomUUID()}`;
  value.hall.id = otherHallId;
  value.hall.draft.snapshot.id = otherHallId;
  value.publishedVersions.forEach((version: { hallId: string }) => {
    version.hallId = otherHallId;
  });
  page.on('dialog', (dialog) => dialog.dismiss());
  await page.getByLabel('Открыть пакет').setInputFiles({
    name: 'collision.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole('alert')).toContainText('already exists');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  const owner = await page.evaluate(async (versionId: string) => {
    const request = indexedDB.open('hall-platform-studio');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const hallId = await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction('versions', 'readonly');
      const get = transaction.objectStore('versions').get(versionId);
      get.onsuccess = () => resolve((get.result as { hallId: string }).hallId);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return hallId;
  }, value.publishedVersions[0].versionId);
  expect(owner).toBe(originalHallId);
});

test('H06: an invalid PDF in a package cannot replace the working hall', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт пакета' }).click();
  const value = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  value.hall.draft.assets.invalid = {
    kind: 'pdf',
    name: 'broken.pdf',
    dataUrl: 'data:application/pdf;base64,AAAA',
    pages: [{ width: 100, height: 100 }],
  };
  await page.getByLabel('Открыть пакет').setInputFiles({
    name: 'broken-package.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole('alert')).toContainText(
    'invalid or oversized PDF',
  );
  await expect(page.locator('.hall-card')).toHaveCount(4);
});

test('H06: a conflicting recovery draft can be exported safely', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.evaluate(async () => {
    const request = indexedDB.open('hall-platform-studio');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ['halls', 'recovery'],
        'readwrite',
      );
      const halls = transaction.objectStore('halls').getAll();
      halls.onsuccess = () => {
        const hall = halls.result[0] as
          { id: string; draft: unknown } | undefined;
        if (!hall) throw new Error('Missing hall');
        transaction.objectStore('recovery').put({
          hallId: hall.id,
          draft: hall.draft,
          baseRevision: 0,
          updatedAt: new Date(Date.now() - 60_000).toISOString(),
        });
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(
    page.getByText(/конфликт версий, экспортируйте копию/),
  ).toBeVisible();
  expect(
    await page.getByRole('button', { name: 'Восстановить черновик' }).count(),
  ).toBe(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспортировать копию' }).click();
  const value = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  expect(value.snapshot.id).toBeTruthy();
});

test('R06: failed demo reset leaves the saved hall intact', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('button', { name: 'К списку залов' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(5);
  await page
    .locator('.hall-card', { hasText: 'Новый зал' })
    .getByRole('button', { name: 'Открыть черновик' })
    .click();
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
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Сбросить демо-данные' }).click();
  await expect(page.locator('.hall-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Демо-мероприятия' }).click();
  await expect(page.locator('.demo-events .hall-card')).toHaveCount(4);
});

import { expect, test } from '@playwright/test';
import { createEmptyDraft } from '@hall-platform/domain';

test('migrates legacy hall and publication metadata stores', async ({
  page,
}) => {
  const draft = createEmptyDraft('Legacy catalog hall');
  const published = {
    versionId: 'version-legacy-1',
    hallId: draft.snapshot.id,
    versionNumber: 1,
    publishedAt: new Date().toISOString(),
    layout: {
      ...draft,
      snapshot: {
        ...draft.snapshot,
        id: 'snapshot-legacy-1',
        layoutVersionId: 'version-legacy-1',
        floors: draft.snapshot.floors.map((floor) => ({
          ...floor,
          layoutVersionId: 'version-legacy-1',
        })),
      },
    },
  };
  const record = {
    id: draft.snapshot.id,
    draft,
    updatedAt: new Date().toISOString(),
    revision: 4,
    publishedVersionNumber: 1,
  };

  await page.route('**/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>IndexedDB migration setup</title>',
    }),
  );
  await page.goto('/');
  await page.evaluate(
    async ({ hall, publishedVersion }) =>
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('hall-platform-studio', 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('halls', { keyPath: 'id' });
          const versions = db.createObjectStore('versions', {
            keyPath: 'versionId',
          });
          versions.createIndex('hallId', 'hallId');
          db.createObjectStore('assets', { keyPath: 'key' });
          db.createObjectStore('recovery', { keyPath: 'hallId' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(
            ['halls', 'versions'],
            'readwrite',
          );
          transaction.objectStore('halls').put(hall);
          transaction.objectStore('versions').put(publishedVersion);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    { hall: record, publishedVersion: published },
  );
  await page.unroute('**/*');

  await page.goto('/');
  const legacyHall = page
    .locator('.hall-card')
    .filter({ hasText: 'Legacy catalog hall' });
  await expect(legacyHall).toContainText('0 мест');
  await legacyHall.getByRole('button', { name: 'Открыть черновик' }).click();
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Legacy catalog hall',
  );
  const versionButton = page.getByRole('button', { name: 'Версия 1' });
  await expect(versionButton).toBeVisible();

  await page.evaluate(
    async (versionId) =>
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('hall-platform-studio');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(
            ['publishedVersionMetadata'],
            'readwrite',
          );
          transaction.objectStore('publishedVersionMetadata').delete(versionId);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    published.versionId,
  );
  await page.reload();
  await page
    .locator('.hall-card')
    .filter({ hasText: 'Legacy catalog hall' })
    .getByRole('button', { name: 'Открыть черновик' })
    .click();
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Legacy catalog hall',
  );
  await expect(page.getByRole('button', { name: 'Версия 1' })).toBeVisible();

  await versionButton.click();
  await expect(page.getByText('Опубликовано: 0 мест')).toBeVisible();
  await page.getByRole('button', { name: 'Редактор', exact: true }).click();
  await page.getByRole('button', { name: 'Покупательская схема' }).click();
  await expect(
    page.getByRole('heading', { name: 'Покупательская схема' }),
  ).toBeVisible();
});

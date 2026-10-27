import { expect, test } from '@playwright/test';
import { openCatalogServices } from './navigation';

test('creates and reopens the 50,000-seat performance hall', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await openCatalogServices(page);

  const createStarted = performance.now();
  await page
    .getByRole('button', { name: 'Создать тестовый зал · 50 000 мест' })
    .click({ timeout: 5_000 });
  await expect(page.locator('.hall-editor-header')).toContainText(
    '50000 мест',
    {
      timeout: 120_000,
    },
  );
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Тестовый зал — 50 000 мест',
  );
  const createAndOpenMs = performance.now() - createStarted;

  await page.getByRole('button', { name: 'К списку залов' }).click();
  const performanceHall = page
    .locator('.hall-card')
    .filter({ hasText: 'Тестовый зал — 50 000 мест' });
  await expect(performanceHall).toContainText('50000 мест');
  await openCatalogServices(page);
  const reopenStarted = performance.now();
  await page
    .getByRole('button', { name: 'Открыть тестовый зал · 50 000 мест' })
    .click();

  await expect(page.locator('.hall-editor-header')).toContainText(
    '50000 мест',
    {
      timeout: 120_000,
    },
  );
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Тестовый зал — 50 000 мест',
  );
  console.log(
    JSON.stringify({
      hall: '50,000 seats',
      createAndOpenMs: Math.round(createAndOpenMs),
      reopenMs: Math.round(performance.now() - reopenStarted),
    }),
  );
});

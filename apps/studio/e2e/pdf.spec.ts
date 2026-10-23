import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makeTwoPagePdf } from './pdfFixture';

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

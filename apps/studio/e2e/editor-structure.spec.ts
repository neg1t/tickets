import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('creates a second floor with GA polygon and non-saleable objects', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await page.getByRole('button', { name: 'Добавить этаж' }).click();
  await expect(page.getByLabel('Активный этаж')).toHaveValue(/floor-/);
  await expect(
    page.getByRole('combobox', { name: 'Этаж', exact: true }),
  ).toHaveValue(await page.getByLabel('Активный этаж').inputValue());
  const stage = page.locator('#hall-stage');
  for (const [tool, x] of [
    ['GA-зона', 250],
    ['Сцена', 350],
    ['Подпись', 450],
    ['Препятствие', 550],
  ] as const) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await stage.click({ position: { x, y: 250 } });
  }
  await page.getByRole('button', { name: 'GA-зона', exact: true }).click();
  await stage.click({ position: { x: 250, y: 350 } });
  await page.getByRole('button', { name: 'Преобразовать в полигон' }).click();
  await expect(page.getByLabel('Вершина 1 X')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  expect(draft.snapshot.floors).toHaveLength(2);
  expect(
    draft.snapshot.decorations
      .map((item: { kind: string }) => item.kind)
      .sort(),
  ).toEqual(['label', 'obstacle', 'stage']);
  expect(
    draft.snapshot.zones.some(
      (zone: { kind: string; polygon?: unknown[] }) =>
        zone.kind === 'ga' && zone.polygon?.length === 4,
    ),
  ).toBe(true);
  expect(draft.snapshot.seats).toHaveLength(0);
  await page.getByRole('button', { name: 'Вписать' }).click();
  await page.screenshot({
    path: test.info().outputPath('h02-structure.png'),
    fullPage: true,
  });
});

test('blocks publishing duplicate seat numbers in one scope', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 300, y: 260 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 500, y: 260 } });
  await page.getByLabel('Номер места').fill('1');
  await page.getByLabel('Номер места').blur();
  await expect(page.getByText(/Повтор номера/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Опубликовать' }),
  ).toBeDisabled();
});

test('requires an explicit decision before publishing collision warnings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 300, y: 260 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 310, y: 260 } });
  await expect(page.getByText(/пересекаются/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Опубликовать' }),
  ).toBeDisabled();
  await page.getByLabel('Публиковать с предупреждениями').check();
  await expect(
    page.getByRole('button', { name: 'Опубликовать' }),
  ).toBeEnabled();
});

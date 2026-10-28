import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openCurrentEditor } from './navigation';

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
  const editShape = page.getByRole('button', { name: 'Изменить форму' });
  await editShape.click();
  await expect(editShape).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.locator('.hall-editor')).toHaveAttribute(
    'data-validation-status',
    'current',
  );
  await expect(page.getByText(/пересекаются/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Опубликовать' }),
  ).toBeDisabled();
  await page.getByLabel('Публиковать с предупреждениями').check();
  await expect(
    page.getByRole('button', { name: 'Опубликовать' }),
  ).toBeEnabled();
});

test('object tree searches, selects, hides, and restores a sector', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openCurrentEditor(page);
  const viewer = page.locator('.hall-viewer-canvas');
  const initialSeatCount = Number(
    await viewer.getAttribute('data-floor-seat-count'),
  );

  await page.getByLabel('Найти объект').fill('L1-1');
  const seatSelect = page.getByRole('button', { name: 'Выбрать Место L1-1' });
  await expect(seatSelect).toBeVisible();
  await seatSelect.click();
  await expect(page.locator('.hall-viewer-status')).toContainText('Выбрано: 1');
  const scaleBeforeFocus = Number(
    await viewer.getAttribute('data-viewport-scale'),
  );
  await page.getByRole('button', { name: 'К выбранному' }).click();
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(scaleBeforeFocus);

  await page.getByLabel('Найти объект').fill('Left sector');
  await page.getByRole('button', { name: 'Скрыть Зона Left sector' }).click();
  await expect
    .poll(async () =>
      Number(await viewer.getAttribute('data-floor-seat-count')),
    )
    .toBeLessThan(initialSeatCount);
  await page.getByLabel('Найти объект').fill('L1');
  await expect(
    page.getByRole('button', { name: 'Показать Ряд L1' }),
  ).toBeDisabled();

  await page.getByLabel('Найти объект').fill('Left sector');
  await page.getByRole('button', { name: 'Показать Зона Left sector' }).click();
  await expect(viewer).toHaveAttribute(
    'data-floor-seat-count',
    String(initialSeatCount),
  );
});

test('locking a selected row disables its properties and can be reversed', async ({
  page,
}) => {
  await page.goto('/');
  await openCurrentEditor(page);
  await page.getByLabel('Найти объект').fill('L1');
  await page.getByRole('button', { name: 'Заблокировать Ряд L1' }).click();
  await page.getByRole('button', { name: 'Выбрать Ряд L1' }).click();
  const changeCount = Number(
    await page.locator('.studio-editor-page').getAttribute('data-change-count'),
  );
  await page.keyboard.press('Delete');
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    String(changeCount),
  );

  await expect(
    page.getByText(
      'Выбранный объект заблокирован. Снимите блокировку в дереве объектов.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Название ряда')).toBeDisabled();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  const seat = draft.snapshot.seats.find(
    (item: { placement?: { kind: string; rowId?: string } }) =>
      item.placement?.kind === 'row' &&
      item.placement.rowId === 'small-theater-row-left-1',
  ) as { position: { x: number; y: number } } | undefined;
  if (!seat) throw new Error('The locked row has no seats');
  const viewer = page.locator('.hall-viewer-canvas');
  const stage = page.locator('#hall-stage');
  const stageBounds = await stage.boundingBox();
  if (!stageBounds) throw new Error('The canvas has no bounds');
  const viewport = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  const seatPoint = {
    x: stageBounds.x + viewport.x + seat.position.x * viewport.scale,
    y: stageBounds.y + viewport.y + seat.position.y * viewport.scale,
  };
  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.down();
  await page.mouse.move(seatPoint.x + 30, seatPoint.y + 10, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    String(changeCount),
  );

  await page.getByRole('button', { name: 'Разблокировать Ряд L1' }).click();
  await expect(page.getByLabel('Название ряда')).toBeEnabled();
});

test('mobile editor toolbar uses labelled SVG controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openCurrentEditor(page);
  const nav = page.getByRole('navigation', { name: 'Панели редактора' });
  await expect(nav).toBeVisible();
  await expect(nav.locator('button svg')).toHaveCount(5);
  await nav.getByRole('button', { name: 'Слои' }).click();
  await expect(nav.getByRole('button', { name: 'Слои' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('region', { name: 'Дерево объектов' }),
  ).toBeVisible();
});

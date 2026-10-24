import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function exportDraft(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8')) as {
    snapshot: {
      seats: { position: { x: number; y: number } }[];
      rows: unknown[];
      tables: unknown[];
      decorations: { kind: string }[];
    };
  };
}

test('empty hall starter creates and undoes a complete example', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  await expect(page.getByText('Начните схему зала')).toBeVisible();
  await page.getByRole('button', { name: 'Готовый шаблон' }).click();
  await page.screenshot({
    path: 'apps/studio/test-output/h04-template.png',
    fullPage: true,
  });
  const draft = await exportDraft(page);
  expect(draft.snapshot.rows).toHaveLength(1);
  expect(draft.snapshot.tables).toHaveLength(1);
  expect(draft.snapshot.decorations.some((item) => item.kind === 'stage')).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Отменить' }).click();
  expect((await exportDraft(page)).snapshot.rows).toHaveLength(0);
});

test('box selection, alignment and duplicate each commit once', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 240 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 450, y: 270 } });
  const { x: stageX, y: stageY } = await stage.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  await page.mouse.move(stageX + 380, stageY + 220);
  await page.mouse.down();
  await page.mouse.move(stageX + 470, stageY + 290, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/Выбрано: 2/)).toBeVisible();
  await page.getByRole('button', { name: 'По верхнему краю' }).click();
  const aligned = (await exportDraft(page)).snapshot.seats;
  expect(aligned[0]?.position.y).toBeCloseTo(
    aligned[1]?.position.y ?? Number.NaN,
  );
  await page.getByRole('button', { name: 'Дублировать' }).click();
  await page.screenshot({
    path: 'apps/studio/test-output/h04-selection.png',
    fullPage: true,
  });
  expect((await exportDraft(page)).snapshot.seats).toHaveLength(4);
  await page.getByRole('button', { name: 'Отменить' }).click();
  expect((await exportDraft(page)).snapshot.seats).toHaveLength(2);
});

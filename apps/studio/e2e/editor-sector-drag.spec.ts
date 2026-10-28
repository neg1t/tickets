import { expect, test } from '@playwright/test';
import { createPerformanceHallDraft } from '@hall-platform/fixtures';

test('previews a sector drag as one group without expanding its seats into nodes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const draft = createPerformanceHallDraft(5_000);
  const sector = draft.snapshot.zones.find((zone) => zone.id === 'z1');
  if (!sector) throw new Error('Missing the first performance sector');
  const movedSeatCount = draft.snapshot.seats.filter(
    (seat) => seat.zoneId === sector.id,
  ).length;
  expect(movedSeatCount).toBeGreaterThan(1_000);
  const movedRowCount = draft.snapshot.rows.filter(
    (row) => row.zoneId === sector.id,
  ).length;
  const movedTableCount = draft.snapshot.tables.filter(
    (table) => table.zoneId === sector.id,
  ).length;
  const expectedMovingTargets =
    movedSeatCount + movedRowCount + movedTableCount + 1;

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'performance-sector-drag.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    draft.hallName,
    { timeout: 60_000 },
  );

  const viewer = page.locator('.hall-viewer-canvas');
  const stage = page.locator('#hall-stage');
  const camera = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing performance hall stage bounds');
  const point = {
    x: bounds.x + camera.x + 1_900 * camera.scale,
    y: bounds.y + camera.y + 2_850 * camera.scale,
  };
  expect(point.x).toBeGreaterThan(bounds.x);
  expect(point.x).toBeLessThan(bounds.x + bounds.width);
  expect(point.y).toBeGreaterThan(bounds.y);
  expect(point.y).toBeLessThan(bounds.y + bounds.height);

  const originalChangeCount = await page
    .locator('.studio-editor-page')
    .getAttribute('data-change-count');
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.hall-editor-selection-path')).toContainText(
    `zone · ${sector.id}`,
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(viewer).toHaveAttribute(
    'data-pointer-target',
    `zone:${sector.id}`,
  );
  await expect(viewer).toHaveAttribute(
    'data-moving-target-count',
    String(expectedMovingTargets),
  );
  await page.mouse.move(point.x + 16, point.y + 12, { steps: 3 });
  expect(
    Number(await viewer.getAttribute('data-seat-render-nodes')),
  ).toBeLessThan(1_000);
  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(viewer).toHaveAttribute('data-moving-target-count', '0');
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    originalChangeCount ?? '0',
  );
});

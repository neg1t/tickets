import { expect, test } from '@playwright/test';
import { createPerformanceHallDraft } from '@hall-platform/fixtures';

test('dragging one seat keeps the other seats batched in a 50k hall @performance', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const draft = createPerformanceHallDraft(50_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'performance-single-drag-50k.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });

  const viewer = page.locator('.hall-viewer-canvas');
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    draft.hallName,
    { timeout: 120_000 },
  );
  await expect(viewer).toHaveAttribute('data-floor-seat-count', '28908');
  await expect(viewer).toHaveAttribute('data-seat-renderer-engine', 'canvas');
  const initialRenderNodes = Number(
    await viewer.getAttribute('data-seat-render-nodes'),
  );
  expect(initialRenderNodes).toBeLessThan(1_000);

  const viewport = await viewer.evaluate((element) => ({
    x: Number(element.getAttribute('data-viewport-x')),
    y: Number(element.getAttribute('data-viewport-y')),
    scale: Number(element.getAttribute('data-viewport-scale')),
  }));
  const viewerBounds = await viewer.boundingBox();
  if (!viewerBounds) throw new Error('Missing large hall viewer bounds');
  const seat = draft.snapshot.seats.find(({ floorId, position }) => {
    if (floorId !== draft.snapshot.floors[0]?.id) return false;
    const x = viewport.x + position.x * viewport.scale;
    const y = viewport.y + position.y * viewport.scale;
    return (
      x >= 30 &&
      x <= viewerBounds.width - 30 &&
      y >= 30 &&
      y <= viewerBounds.height - 30
    );
  });
  if (!seat) throw new Error('No first-floor seat is visible at the current zoom');
  const seatPoint = {
    x: viewerBounds.x + viewport.x + seat.position.x * viewport.scale,
    y: viewerBounds.y + viewport.y + seat.position.y * viewport.scale,
  };

  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.down();
  await expect(viewer).toHaveAttribute('data-pointer-mode', 'edit');
  await expect(viewer).toHaveAttribute(
    'data-pointer-target',
    `seat:${seat.id}`,
  );
  await expect(viewer).toHaveAttribute('data-moving-target-count', '1');
  await page.mouse.move(seatPoint.x + 40, seatPoint.y + 20, {
    steps: 5,
  });
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-moving-target-count')))
    .toBeGreaterThan(0);
  const duringDragRenderNodes = Number(
    await viewer.getAttribute('data-seat-render-nodes'),
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();

  expect(duringDragRenderNodes).toBeLessThan(1_000);
  await expect(viewer).toHaveAttribute(
    'data-seat-render-nodes',
    String(initialRenderNodes),
  );
});

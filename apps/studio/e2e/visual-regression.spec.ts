import { expect, test } from '@playwright/test';
import { createDraftFromSnapshot, layoutSnapshotSchema } from '@hall-platform/domain';
import { makeLargeHallFixture } from './largeHallFixture';

test('large hall returns to the same rendered image after pan and fit', async ({ page }) => {
  const fixture = makeLargeHallFixture(1_000);
  const draft = createDraftFromSnapshot('Visual grid 1k', layoutSnapshotSchema.parse(fixture.document.snapshot));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо и обслуживание' }).last().click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'visual-grid-1k.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  const stage = page.locator('#hall-stage');
  await expect(stage).toBeVisible();
  await page.getByRole('button', { name: 'Рука' }).click();
  await page.getByRole('button', { name: 'Вписать' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const before = await stage.screenshot();
  const beforeViewport = await page.locator('.hall-viewer-canvas').evaluate((element) => ({
    x: element.getAttribute('data-viewport-x'), y: element.getAttribute('data-viewport-y'),
    scale: element.getAttribute('data-viewport-scale'),
  }));
  const box = await stage.boundingBox();
  if (!box) throw new Error('Stage bounds are missing');
  await page.mouse.move(box.x + 220, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 180, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Вписать' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const after = await stage.screenshot();
  const afterViewport = await page.locator('.hall-viewer-canvas').evaluate((element) => ({
    x: element.getAttribute('data-viewport-x'), y: element.getAttribute('data-viewport-y'),
    scale: element.getAttribute('data-viewport-scale'),
  }));
  expect(afterViewport).toEqual(beforeViewport);
  await test.info().attach('visual-grid-1k', { body: after, contentType: 'image/png' });
  const diffRatio = await page.evaluate(async ([first, second]) => {
    async function pixels(base64: string) {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    }
    const a = await pixels(first);
    const b = await pixels(second);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Image dimensions changed');
    let changed = 0;
    for (let index = 0; index < a.data.length; index += 4) {
      if (Math.abs((a.data[index] ?? 0) - (b.data[index] ?? 0)) > 10 ||
        Math.abs((a.data[index + 1] ?? 0) - (b.data[index + 1] ?? 0)) > 10 ||
        Math.abs((a.data[index + 2] ?? 0) - (b.data[index + 2] ?? 0)) > 10) changed += 1;
    }
    return changed / (a.width * a.height);
  }, [before.toString('base64'), after.toString('base64')] as const);
  console.log(`visual grid changed pixels: ${(diffRatio * 100).toFixed(2)}%`);
  expect(diffRatio).toBeLessThan(0.01);
});

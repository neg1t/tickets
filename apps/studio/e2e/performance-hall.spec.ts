import { expect, test } from '@playwright/test';
import { openCatalogServices } from './navigation';
import {
  attachPerformanceReport,
  installPerformanceObserver,
  measureFrameIntervals,
  percentile,
  waitForPaint,
} from './performance-metrics';

test('creates and reopens the 50,000-seat performance hall', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installPerformanceObserver(page);
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
  await waitForPaint(page);
  const initialCanvasNodes = await page.locator('.hall-viewer-canvas').count();

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
  const reopenMs = performance.now() - reopenStarted;
  await waitForPaint(page);

  await page.getByRole('button', { name: 'Рука' }).click();
  const stage = page.locator('#hall-stage');
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing performance hall stage bounds');
  const frameIntervals = measureFrameIntervals(page, 180);
  await page.mouse.move(bounds.x + 250, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 550, bounds.y + 220, { steps: 45 });
  await page.mouse.up();
  const frames = await frameIntervals;

  await attachPerformanceReport(page, test.info(), 'performance-hall-50000', {
    scenario: 'create, reopen, and pan 50,000-seat editor',
    buildMode: 'Vite production preview',
    fixture: 'performance-hall-50000',
    seatCount: 50_000,
    viewport: { width: 1280, height: 800 },
    createAndOpenMs: Math.round(createAndOpenMs),
    reopenMs: Math.round(reopenMs),
    initialCanvasNodes,
    panFrameP95Ms: Math.round(percentile(frames, 0.95) * 100) / 100,
    panFrameMaxMs: Math.round(Math.max(...frames) * 100) / 100,
    panFrameSamples: frames.length,
  });
});

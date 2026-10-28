import { expect, test } from '@playwright/test';
import { openCatalogServices } from './navigation';
import {
  beginGestureMetrics,
  endGestureMetrics,
  attachPerformanceReport,
  installPerformanceObserver,
  percentile,
  waitForPaint,
} from './performance-metrics';

test('creates and reopens the 50,000-seat performance hall @performance', async ({
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
  const activeFloorSeatCount = Number(
    await page
      .locator('.hall-viewer-canvas')
      .getAttribute('data-floor-seat-count'),
  );
  const initialSeatRenderNodes = Number(
    await page
      .locator('.hall-viewer-canvas')
      .getAttribute('data-seat-render-nodes'),
  );
  expect(activeFloorSeatCount).toBeGreaterThan(10_000);
  expect(initialSeatRenderNodes).toBeGreaterThan(0);
  expect(initialSeatRenderNodes).toBeLessThan(1_000);

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
  const panRuns = [];
  for (let run = 0; run < 3; run += 1) {
    const startX = bounds.x + 220 + run * 10;
    const startY = bounds.y + 220 + run * 8;
    await beginGestureMetrics(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 180, startY + 35, { steps: 30 });
    await page.mouse.up();
    panRuns.push(await endGestureMetrics(page));
  }
  expect(panRuns).toHaveLength(3);
  expect(panRuns.every((run) => run.frameIntervalsMs.length > 0)).toBe(true);

  await attachPerformanceReport(page, test.info(), 'performance-hall-50000', {
    scenario: 'create, reopen, and pan 50,000-seat editor',
    buildMode: 'Vite production preview',
    fixture: 'performance-hall-50000',
    seatCount: 50_000,
    activeFloorSeatCount,
    viewport: { width: 1280, height: 800 },
    createAndOpenMs: Math.round(createAndOpenMs),
    reopenMs: Math.round(reopenMs),
    initialSeatRenderNodes,
    panRuns: panRuns.map((run) => ({
      durationMs: Math.round(run.durationMs * 100) / 100,
      inputToStateFeedbackMs:
        run.inputToStateFeedbackMs === null
          ? null
          : Math.round(run.inputToStateFeedbackMs * 100) / 100,
      frameP95Ms:
        Math.round(percentile(run.frameIntervalsMs, 0.95) * 100) / 100,
      frameMaxMs:
        run.frameIntervalsMs.length > 0
          ? Math.round(Math.max(...run.frameIntervalsMs) * 100) / 100
          : null,
      frameSamples: run.frameIntervalsMs.length,
      longTasks: run.longTasks.map(
        ({ duration }) => Math.round(duration * 100) / 100,
      ),
    })),
  });
});

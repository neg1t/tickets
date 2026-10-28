import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { cpus, platform, totalmem } from 'node:os';
import { performance as nodePerformance } from 'node:perf_hooks';
import {
  attachPerformanceReport,
  beginGestureMetrics,
  endGestureMetrics,
  installPerformanceObserver,
  percentile,
  waitForPaint,
} from './performance-metrics';

test.skip(
  process.env['HALL_MEASURE_BASELINE'] !== '1',
  'Run only for an explicit baseline capture',
);

test('records Arena editor startup and pan frame baseline @performance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const openMs: number[] = [];
  const panRuns = [];
  await installPerformanceObserver(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Мои залы' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.hall-card')).toHaveCount(4, {
      timeout: 30_000,
    });
    const openedAt = nodePerformance.now();
    await page
      .locator('.hall-card', { hasText: 'Arena' })
      .getByRole('button', { name: 'Открыть черновик' })
      .click();
    const stage = page.locator('#hall-stage');
    await expect(stage).toBeVisible();
    await waitForPaint(page);
    openMs.push(nodePerformance.now() - openedAt);

    await page.getByRole('button', { name: 'Рука' }).click();
    const bounds = (await stage.boundingBox()) as { x: number; y: number };
    await beginGestureMetrics(page);
    await page.mouse.move(bounds.x + 250, bounds.y + 220);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 550, bounds.y + 220, { steps: 45 });
    await page.mouse.up();
    panRuns.push(await endGestureMetrics(page));
  }

  const browser = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
  }));
  const baseline = {
    capturedAt: new Date().toISOString(),
    machine: {
      platform: platform(),
      cpu: cpus()[0]?.model,
      totalMemoryBytes: totalmem(),
    },
    browser,
    viewport: { width: 1280, height: 800 },
    buildMode: 'Vite development server',
    fixture: 'Arena, 128 seats',
    samples: 3,
    method:
      'Three active pointer gestures; RAF intervals sampled from pointerdown to pointerup; input feedback measured from pointerdown to viewport state change',
    openMs,
    panRuns: panRuns.map((run) => ({
      durationMs: run.durationMs,
      inputToStateFeedbackMs: run.inputToStateFeedbackMs,
      frameP95Ms: percentile(run.frameIntervalsMs, 0.95),
      frameMaxMs: Math.max(...run.frameIntervalsMs),
      frameSamples: run.frameIntervalsMs.length,
      longTasks: run.longTasks,
    })),
    openMedianMs: percentile(openMs, 0.5),
    panMedianP95Ms: percentile(
      panRuns.map((run) => percentile(run.frameIntervalsMs, 0.95)),
      0.5,
    ),
  };
  expect(panRuns).toHaveLength(3);
  expect(panRuns.every((run) => run.frameIntervalsMs.length > 0)).toBe(true);
  await attachPerformanceReport(
    page,
    test.info(),
    'performance-baseline',
    baseline,
  );
  await writeFile(
    test.info().outputPath('performance-baseline.json'),
    JSON.stringify(baseline, null, 2),
  );
});

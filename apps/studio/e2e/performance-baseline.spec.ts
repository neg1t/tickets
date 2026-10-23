import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, platform, totalmem } from 'node:os';
import { performance as nodePerformance } from 'node:perf_hooks';

test.skip(
  process.env['HALL_MEASURE_BASELINE'] !== '1',
  'Run only for an explicit baseline capture',
);

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

test('records Arena editor startup and pan frame baseline', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const openMs: number[] = [];
  const panP95Ms: number[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/');
    await expect(page.locator('.hall-card')).toHaveCount(4);
    const openedAt = nodePerformance.now();
    await page
      .locator('.hall-card', { hasText: 'Arena' })
      .getByRole('button', { name: 'Открыть черновик' })
      .click();
    const stage = page.locator('#hall-stage');
    await expect(stage).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    openMs.push(nodePerformance.now() - openedAt);

    await page.getByRole('button', { name: 'Рука' }).click();
    const bounds = (await stage.boundingBox()) as { x: number; y: number };
    const frames = page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const samples: number[] = [];
          let previous = globalThis.performance.now();
          const tick = (now: number) => {
            samples.push(now - previous);
            previous = now;
            if (samples.length < 90) requestAnimationFrame(tick);
            else resolve(samples);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.mouse.move(bounds.x + 250, bounds.y + 220);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 550, bounds.y + 220, { steps: 45 });
    await page.mouse.up();
    panP95Ms.push(percentile(await frames, 0.95));
  }

  const browser = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
  }));
  const baseline = {
    date: '2026-10-23',
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
      'Playwright click to two animation frames; 90 RAF intervals around a 45-step pan',
    openMs,
    panP95Ms,
    openMedianMs: percentile(openMs, 0.5),
    panMedianP95Ms: percentile(panP95Ms, 0.5),
  };
  const body = JSON.stringify(baseline, null, 2);
  await test.info().attach('performance-baseline', {
    body,
    contentType: 'application/json',
  });
  const directory = join(test.info().config.rootDir, 'baselines');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'performance-baseline.json'), body);
});

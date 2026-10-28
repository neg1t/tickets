import { expect, test } from '@playwright/test';
import {
  createPerformanceHallDraft,
  type PerformanceHallSize,
} from '@hall-platform/fixtures';
import {
  attachPerformanceReport,
  installPerformanceObserver,
  percentile,
  waitForPaint,
} from './performance-metrics';
import { openBuyer } from './navigation';

test.skip(
  process.env['HALL_MEASURE_PERFORMANCE'] !== '1',
  'Run explicitly against the production preview',
);

test('measures 5,000-seat editor readiness on mobile @performance', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'Run with HALL_BROWSER_MATRIX=1 and --project=mobile-chromium',
  );
  test.setTimeout(120_000);
  const seatCount: PerformanceHallSize = 5_000;
  const draft = createPerformanceHallDraft(seatCount);
  await installPerformanceObserver(page);
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();

  const importStartedAt = performance.now();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: `performance-${seatCount}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    draft.hallName,
    { timeout: 90_000 },
  );
  await expect(page.locator('#hall-stage')).toBeVisible({ timeout: 30_000 });
  await waitForPaint(page);
  const importToFirstPaintMs = performance.now() - importStartedAt;

  await attachPerformanceReport(
    page,
    testInfo,
    'mobile-editor-performance-5000',
    {
      scenario: 'import and first painted frame in editor',
      buildMode: 'Vite production preview',
      fixture: 'multi-floor performance hall with PDF background',
      seatCount,
      importToFirstPaintMs: Math.round(importToFirstPaintMs),
    },
  );
});

test('measures buyer readiness and selection feedback on mobile @performance', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chromium',
    'Run with HALL_BROWSER_MATRIX=1 and --project=mobile-chromium',
  );
  await installPerformanceObserver(page);
  const buyerStartedAt = performance.now();
  await page.goto('/');
  await openBuyer(page);
  const availableSeat = page.locator(
    '.seat-view-seat-list button:not([disabled])',
  );
  await expect(availableSeat.first()).toBeVisible({ timeout: 30_000 });
  await waitForPaint(page);
  const buyerToSelectableSeatMs = performance.now() - buyerStartedAt;
  const selectionLatencies = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>(
      '.seat-view-seat-list button:not([disabled])',
    );
    if (!button) throw new Error('No selectable seat is rendered');
    const samples: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const before = button.getAttribute('aria-pressed');
      const elapsed = await new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const timeout = window.setTimeout(() => {
          observer.disconnect();
          reject(new Error('Selection feedback timed out'));
        }, 1_000);
        const observer = new MutationObserver(() => {
          if (button.getAttribute('aria-pressed') === before) return;
          window.clearTimeout(timeout);
          observer.disconnect();
          resolve(performance.now() - started);
        });
        observer.observe(button, {
          attributes: true,
          attributeFilter: ['aria-pressed'],
        });
        button.click();
      });
      samples.push(elapsed);
    }
    return samples;
  });

  await attachPerformanceReport(page, testInfo, 'mobile-buyer-performance', {
    scenario:
      'open buyer and select an available seat from the accessible list',
    buildMode: 'Vite production preview',
    fixture: 'default published demo hall',
    buyerToSelectableSeatMs: Math.round(buyerToSelectableSeatMs),
    selectionSamplesMs: selectionLatencies.map(
      (sample) => Math.round(sample * 100) / 100,
    ),
    selectionP95Ms:
      Math.round(percentile(selectionLatencies, 0.95) * 100) / 100,
  });
});

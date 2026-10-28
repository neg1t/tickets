import { test, expect } from '@playwright/test';
import { performance as nodePerformance } from 'node:perf_hooks';
import { cpus, platform } from 'node:os';
import {
  createDraftFromSnapshot,
  layoutSnapshotSchema,
} from '@hall-platform/domain';
import {
  createPerformanceHallDraft,
  PERFORMANCE_HALL_SIZES,
  type PerformanceHallSize,
} from '@hall-platform/fixtures';
import { makeLargeHallFixture } from './largeHallFixture';
import { openBuyer } from './navigation';
import {
  beginGestureMetrics,
  endGestureMetrics,
  attachPerformanceReport,
  collectBrowserMetrics,
  installPerformanceObserver,
  percentile,
  waitForPaint,
} from './performance-metrics';

test.skip(
  process.env['HALL_MEASURE_PERFORMANCE'] !== '1',
  'Run explicitly against the production preview',
);

test('measures large editor open and pan @performance', async ({ page }) => {
  test.setTimeout(180_000);
  const requestedSize = Number(process.env['HALL_FIXTURE_SIZE'] ?? '50000');
  if (!PERFORMANCE_HALL_SIZES.includes(requestedSize as PerformanceHallSize))
    throw new Error('HALL_FIXTURE_SIZE must be 5000, 50000, or 100000');
  const isLargeGeneratedFixture = requestedSize === 100_000;
  const draft = isLargeGeneratedFixture
    ? null
    : createPerformanceHallDraft(requestedSize as PerformanceHallSize);
  const hallName = `Тестовый зал — ${requestedSize.toLocaleString('ru-RU')} мест`;
  await installPerformanceObserver(page);
  if (test.info().project.name !== 'mobile-chromium')
    await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  const setupStartedAt = nodePerformance.now();
  await page.evaluate(() => performance.mark('e2e:fixture-acquisition:start'));
  if (draft) {
    await page.getByLabel('Открыть JSON').setInputFiles({
      name: `performance-${requestedSize}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(draft)),
    });
  } else {
    await page
      .getByRole('button', {
        name: `Создать тестовый зал · ${requestedSize.toLocaleString('ru-RU')} мест`,
      })
      .click();
  }
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    hallName,
    { timeout: 120_000 },
  );
  const setupToEditorMs = nodePerformance.now() - setupStartedAt;
  await page.evaluate(() => performance.mark('e2e:editor-ready'));
  await expect(page.locator('#hall-stage')).toBeVisible({ timeout: 30_000 });
  await waitForPaint(page);
  await page.evaluate(() => performance.mark('e2e:editor-first-paint'));
  const setupToFirstPaintMs = nodePerformance.now() - setupStartedAt;
  await page.evaluate(() => performance.mark('e2e:reopen:start'));
  await page.getByRole('button', { name: 'К списку залов' }).click();

  const stage = page.locator('#hall-stage');
  const reopenedAt = nodePerformance.now();
  await page
    .locator('.hall-card', { hasText: hallName })
    .getByRole('button', { name: 'Открыть черновик' })
    .click();
  await expect(stage).toBeVisible({ timeout: 90_000 });
  await waitForPaint(page);
  await page.evaluate(() => performance.mark('e2e:reopen:first-paint'));
  const reopenMs = nodePerformance.now() - reopenedAt;

  await page.getByRole('button', { name: 'Рука' }).click();
  for (let zoom = 0; zoom < 6; zoom += 1)
    await page.getByRole('button', { name: 'Увеличить' }).click();
  const panScale = Number(
    await page
      .locator('.hall-viewer-canvas')
      .getAttribute('data-viewport-scale'),
  );
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing stage bounds');
  const panRuns = [];
  for (let run = 0; run < 3; run += 1) {
    const startX = bounds.x + 250 + run * 12;
    const startY = bounds.y + 220 + run * 8;
    await beginGestureMetrics(page);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 300, startY, { steps: 45 });
    await page.mouse.up();
    panRuns.push(await endGestureMetrics(page));
  }
  expect(panRuns).toHaveLength(3);
  expect(panRuns.every((run) => run.frameIntervalsMs.length > 0)).toBe(true);
  let pinchMs: number | null = null;
  if (test.info().project.name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const pinchStartedAt = nodePerformance.now();
    await cdp.send('Input.synthesizePinchGesture', {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
      scaleFactor: 1.25,
      relativeSpeed: 100,
      gestureSourceType: 'touch',
    });
    await waitForPaint(page);
    pinchMs = nodePerformance.now() - pinchStartedAt;
    await cdp.detach();
  }
  const previewStartedAt = nodePerformance.now();
  await page.getByRole('button', { name: 'Просмотр', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Просмотр', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await waitForPaint(page);
  const previewTransitionMs = nodePerformance.now() - previewStartedAt;
  const longSession =
    process.env['HALL_EXTENDED_PERFORMANCE'] === '1'
      ? await (async () => {
          if (requestedSize === 100_000)
            return {
              cycles: 0,
              skipped: '100k repeat runs exceed the bounded test window',
            };
          const heapBefore = await page.evaluate(
            () =>
              (
                performance as Performance & {
                  memory?: { usedJSHeapSize: number };
                }
              ).memory?.usedJSHeapSize ?? null,
          );
          await page
            .getByRole('button', { name: 'Редактор', exact: true })
            .click();
          const repeatedReopenMs: number[] = [];
          for (let cycle = 0; cycle < 20; cycle += 1) {
            const cycleStartedAt = nodePerformance.now();
            await page.getByRole('button', { name: 'К списку залов' }).click();
            await page
              .locator('.hall-card', { hasText: hallName })
              .getByRole('button', { name: 'Открыть черновик' })
              .click();
            await expect(stage).toBeVisible({ timeout: 90_000 });
            await waitForPaint(page);
            repeatedReopenMs.push(nodePerformance.now() - cycleStartedAt);
          }
          const heapAfter = await page.evaluate(
            () =>
              (
                performance as Performance & {
                  memory?: { usedJSHeapSize: number };
                }
              ).memory?.usedJSHeapSize ?? null,
          );
          return {
            cycles: repeatedReopenMs.length,
            reopenSamplesMs: repeatedReopenMs.map((sample) =>
              Math.round(sample),
            ),
            reopenP75Ms: Math.round(percentile(repeatedReopenMs, 0.75)),
            reopenMaxMs: Math.round(Math.max(...repeatedReopenMs)),
            heapBefore,
            heapAfter,
          };
        })()
      : null;
  await attachPerformanceReport(
    page,
    test.info(),
    `performance-${requestedSize}`,
    {
      scenario: 'import, reopen, and pan editor',
      buildMode: 'Vite production preview',
      fixture: `Arena performance hall, ${requestedSize} seats`,
      setupMethod: isLargeGeneratedFixture
        ? 'in-app performance fixture generator'
        : 'JSON import',
      importBytes: draft ? Buffer.byteLength(JSON.stringify(draft)) : null,
      seatCount: requestedSize,
      setupToEditorMs: Math.round(setupToEditorMs),
      setupToFirstPaintMs: Math.round(setupToFirstPaintMs),
      reopenMs: Math.round(reopenMs),
      panScale,
      pinchMs: pinchMs === null ? null : Math.round(pinchMs),
      previewTransitionMs: Math.round(previewTransitionMs),
      panRuns: panRuns.map((run) => ({
        durationMs: Math.round(run.durationMs * 100) / 100,
        inputToStateFeedbackMs:
          run.inputToStateFeedbackMs === null
            ? null
            : Math.round(run.inputToStateFeedbackMs * 100) / 100,
        rafFrameIntervalP95Ms:
          Math.round(percentile(run.frameIntervalsMs, 0.95) * 100) / 100,
        rafFrameIntervalMaxMs:
          run.frameIntervalsMs.length > 0
            ? Math.round(Math.max(...run.frameIntervalsMs) * 100) / 100
            : null,
        rafFrameSampleCount: run.frameIntervalsMs.length,
        longTasks: run.longTasks.map(
          ({ duration }) => Math.round(duration * 100) / 100,
        ),
      })),
      longSession,
    },
  );
});

test('measures buyer selection feedback @performance', async ({ page }) => {
  await installPerformanceObserver(page);
  const buyerStartedAt = nodePerformance.now();
  await page.goto('/');
  await openBuyer(page);
  const availableSeats = page.locator(
    '.seat-view-seat-list button:not([disabled])',
  );
  await expect(availableSeats.first()).toBeVisible();
  await waitForPaint(page);
  const buyerReadyMs = nodePerformance.now() - buyerStartedAt;
  const searchStartedAt = nodePerformance.now();
  await page.getByRole('searchbox').fill('performance-no-match-query');
  await expect(page.getByText('По фильтру мест не найдено')).toBeVisible();
  await waitForPaint(page);
  const buyerSearchMs = nodePerformance.now() - searchStartedAt;
  await page.getByRole('searchbox').fill('');
  await expect(availableSeats.first()).toBeVisible();
  const samples = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>(
      '.seat-view-seat-list button:not([disabled])',
    );
    if (!button) throw new Error('No selectable seat');
    const times: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const before = button.getAttribute('aria-pressed');
      const elapsed = await new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const timer = window.setTimeout(() => {
          observer.disconnect();
          reject(new Error('Selection feedback timed out'));
        }, 1000);
        const observer = new MutationObserver(() => {
          if (button.getAttribute('aria-pressed') === before) return;
          window.clearTimeout(timer);
          observer.disconnect();
          resolve(performance.now() - started);
        });
        observer.observe(button, {
          attributes: true,
          attributeFilter: ['aria-pressed'],
        });
        button.click();
      });
      times.push(elapsed);
    }
    return times;
  });
  await attachPerformanceReport(page, test.info(), 'buyer-selection-feedback', {
    scenario: 'buyer startup and accessible seat selection',
    buildMode: 'Vite production preview',
    fixture: 'default published demo hall',
    buyerReadyMs: Math.round(buyerReadyMs),
    buyerSearchMs: Math.round(buyerSearchMs),
    searchResult: 'no-match sentinel',
    selectionSamplesMs: samples,
    selectionP95Ms: Math.round(percentile(samples, 0.95) * 100) / 100,
  });
});

test('measures group drag in a 10k-seat editor @performance', async ({
  page,
}) => {
  test.skip(process.env['HALL_MEASURE_GROUP_DRAG'] !== '1');
  test.setTimeout(120_000);
  const fixture = makeLargeHallFixture(10_000);
  const draft = createDraftFromSnapshot(
    'Group drag 10k',
    layoutSnapshotSchema.parse(fixture.document.snapshot),
  );
  await installPerformanceObserver(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'group-drag-10k.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  const stage = page.locator('#hall-stage');
  await expect(stage).toBeVisible();
  for (let step = 0; step < 6; step += 1)
    await page.getByRole('button', { name: 'Увеличить' }).click();
  const viewport = await page
    .locator('.hall-viewer-canvas')
    .evaluate((element) => ({
      x: Number(element.getAttribute('data-viewport-x')),
      y: Number(element.getAttribute('data-viewport-y')),
      scale: Number(element.getAttribute('data-viewport-scale')),
    }));
  const box = await stage.boundingBox();
  if (!box) throw new Error('Stage bounds are missing');
  const worldX =
    Math.round((box.width / 2 - viewport.x) / viewport.scale / 2) * 2;
  const worldY = Math.max(
    0,
    Math.min(
      78,
      Math.round((box.height / 2 - viewport.y) / viewport.scale / 2) * 2,
    ),
  );
  const first = {
    x: box.x + viewport.x + worldX * viewport.scale,
    y: box.y + viewport.y + worldY * viewport.scale,
  };
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText(/Выбрано: 1/).first()).toBeVisible();
  await stage.click({
    position: { x: first.x + 2 * viewport.scale - box.x, y: first.y - box.y },
    modifiers: ['Shift'],
  });
  await expect(page.getByText(/Выбрано: 2/).first()).toBeVisible();
  const dragRuns = [];
  for (let run = 0; run < 3; run += 1) {
    const startX = first.x + run * 80;
    await beginGestureMetrics(
      page,
      '.hall-viewer-canvas',
      'data-moving-target-count',
    );
    await page.mouse.move(startX, first.y);
    await page.mouse.down();
    await page.mouse.move(startX + 80, first.y, { steps: 25 });
    await page.mouse.up();
    dragRuns.push(await endGestureMetrics(page));
  }
  expect(
    dragRuns.every(
      ({ frameIntervalsMs, inputToStateFeedbackMs }) =>
        frameIntervalsMs.length > 0 && inputToStateFeedbackMs !== null,
    ),
  ).toBe(true);
  const browser = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
  }));
  const result = {
    machine: { platform: platform(), cpu: cpus()[0]?.model },
    browser,
    viewport: { width: 1280, height: 800 },
    buildMode: 'Vite production preview',
    fixture: 'Arena grid, 10,000 seats, 250 columns, two selected seats',
    frameBudget: {
      kind: 'raf-frame-interval-p95',
      status: 'recorded' as 'recorded' | 'enforced',
    },
    gpuBudget: {
      status: 'not-enforced' as 'not-enforced' | 'enforced',
      reason: 'Awaiting browser GPU classification',
    },
    dragRuns: dragRuns.map((run) => ({
      durationMs: run.durationMs,
      inputToStateFeedbackMs: run.inputToStateFeedbackMs,
      rafFrameIntervalP95Ms: percentile(run.frameIntervalsMs, 0.95),
      rafFrameIntervalMaxMs: Math.max(...run.frameIntervalsMs),
      sampleCount: run.frameIntervalsMs.length,
      longTasks: run.longTasks.map(({ duration }) => duration),
    })),
    scale: viewport.scale,
  };
  const browserMetrics = await collectBrowserMetrics(page);
  const frameIntervalP95BudgetMs = Number(
    process.env['HALL_DRAG_FRAME_INTERVAL_P95_BUDGET_MS'] ?? '25',
  );
  const enforceFrameBudget =
    process.env['HALL_ENFORCE_FRAME_INTERVAL_P95_BUDGET'] === '1';
  result.frameBudget = {
    kind: 'raf-frame-interval-p95',
    status: enforceFrameBudget ? 'enforced' : 'recorded',
  };
  result.gpuBudget = {
    status: 'not-enforced',
    reason:
      'This scenario enforces RAF frame intervals, not a GPU-specific budget',
  };
  await attachPerformanceReport(page, test.info(), 'group-drag-10k', {
    ...result,
    frameIntervalP95BudgetMs,
    rafFrameIntervalP95Ms: Math.max(
      ...dragRuns.map((run) => percentile(run.frameIntervalsMs, 0.95)),
    ),
    gpu: browserMetrics.browser.gpu,
  });
  if (enforceFrameBudget)
    expect(
      Math.max(
        ...dragRuns.map((run) => percentile(run.frameIntervalsMs, 0.95)),
      ),
    ).toBeLessThanOrEqual(frameIntervalP95BudgetMs);
});

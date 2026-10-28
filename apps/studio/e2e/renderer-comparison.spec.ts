import { expect, test } from '@playwright/test';
import {
  beginGestureMetrics,
  collectBrowserMetrics,
  endGestureMetrics,
  attachPerformanceReport,
  classifyGpu,
  installPerformanceObserver,
  percentile,
  waitForPaint,
} from './performance-metrics';

test('compares Canvas and WebGL on the same 50,000-seat scene @performance', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await installPerformanceObserver(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/rendererComparisonHarness.ts',
      window.location.href,
    ).href;
    await import(moduleUrl);
  });

  const results = [];
  for (const renderer of ['canvas', 'webgl'] as const) {
    const startedAt = await page.evaluate(() => performance.now());
    await page.evaluate(async (engine) => {
      const moduleUrl = new URL(
        '/src/e2e/rendererComparisonHarness.ts',
        window.location.href,
      ).href;
      const harness = await import(moduleUrl);
      harness.mountRendererComparisonHarness(document.body, engine);
    }, renderer);

    const viewer = page.locator('.hall-viewer-canvas');
    await expect(viewer).toHaveAttribute('data-floor-seat-count', '28908');
    await expect(viewer).toHaveAttribute(
      'data-seat-renderer',
      renderer === 'webgl' ? 'external' : 'canvas',
    );
    await expect(viewer).toHaveAttribute('data-seat-renderer-engine', renderer);
    await waitForPaint(page);
    const readyMs = await page.evaluate(
      (started) => Math.round((performance.now() - started) * 100) / 100,
      startedAt,
    );
    const renderNodes = Number(
      await viewer.getAttribute('data-seat-render-nodes'),
    );
    const viewportScale = Number(
      await viewer.getAttribute('data-viewport-scale'),
    );
    const rendererInfo = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-renderer="webgl2"]',
      );
      const gl = canvas?.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return extension && gl
        ? {
            vendor: gl.getParameter(extension.UNMASKED_VENDOR_WEBGL),
            renderer: gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
          }
        : null;
    });
    const gpuClassification = classifyGpu(
      renderer === 'webgl',
      rendererInfo?.vendor,
      rendererInfo?.renderer,
    );
    const bounds = await page
      .locator('#renderer-comparison-stage')
      .boundingBox();
    if (!bounds) throw new Error('Missing renderer comparison stage');

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
    const frameP95Ms = percentile(
      panRuns.flatMap((run) => run.frameIntervalsMs),
      0.95,
    );
    const hardwareWebGL =
      renderer === 'webgl' && gpuClassification === 'hardware';
    const enforceGpuBudget =
      process.env['HALL_ENFORCE_GPU_BUDGET'] === '1';
    const gpuBudget =
      hardwareWebGL && enforceGpuBudget
        ? { status: 'enforced', reason: 'Hardware WebGL detected' }
        : {
            status: 'not-enforced',
            reason: hardwareWebGL
              ? 'GPU budget enforcement was not requested'
              : `GPU frame budget requires hardware WebGL; renderer=${renderer}, GPU=${gpuClassification}`,
          };
    results.push({
      renderer,
      rendererInfo,
      gpuClassification,
      gpuBudget,
      readyMs,
      viewportScale,
      renderNodes,
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
    if (
      process.env['HALL_ENFORCE_GPU_BUDGET'] === '1' &&
      gpuBudget.status === 'enforced'
    )
      expect(frameP95Ms).toBeLessThanOrEqual(
        Number(process.env['HALL_WEBGL_FRAME_BUDGET_MS'] ?? '25'),
      );
    if (
      process.env['HALL_ENFORCE_GPU_BUDGET'] === '1' &&
      gpuBudget.status === 'not-enforced'
    )
      console.log(`[gpu-budget] ${gpuBudget.reason}`);

    if (renderer === 'canvas')
      await page.evaluate(async () => {
        const moduleUrl = new URL(
          '/src/e2e/rendererComparisonHarness.ts',
          window.location.href,
        ).href;
        const harness = await import(moduleUrl);
        harness.unmountRendererComparisonHarness(document.body);
      });
  }

  expect(results).toHaveLength(2);
  expect(
    results.every(
      ({ panRuns }) =>
        panRuns.length === 3 &&
        panRuns.every(({ frameSamples }) => frameSamples > 0),
    ),
  ).toBe(true);
  expect(results[0]?.renderNodes).toBeGreaterThan(0);
  expect(results[1]?.renderNodes).toBe(0);
  const browserMetrics = await collectBrowserMetrics(page);
  expect(browserMetrics.browser.renderer).toBe('webgl');
  expect(browserMetrics.browser.visibleSeatCount).toBeGreaterThan(0);
  await attachPerformanceReport(
    page,
    test.info(),
    'renderer-comparison-50000',
    {
      scenario: 'Canvas and WebGL on identical 50,000-seat data',
      buildMode: 'Vite development server',
      seatCount: 50_000,
      activeFloorSeatCount: Number(
        await page
          .locator('.hall-viewer-canvas')
          .getAttribute('data-floor-seat-count'),
      ),
      results,
    },
  );
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/rendererComparisonHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.unmountRendererComparisonHarness(document.body);
  });
  console.log(`[renderer-comparison] ${JSON.stringify(results)}`);
});

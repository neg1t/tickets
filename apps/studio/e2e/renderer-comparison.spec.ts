import { expect, test } from '@playwright/test';
import {
  measureFrameIntervals,
  percentile,
  waitForPaint,
} from './performance-metrics';

test('compares Canvas and WebGL on the same 50,000-seat scene', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.evaluate(async () => {
    await import('/src/e2e/rendererComparisonHarness.ts');
  });

  const results = [];
  for (const renderer of ['canvas', 'webgl'] as const) {
    const startedAt = await page.evaluate(() => performance.now());
    await page.evaluate(async (engine) => {
      const harness = await import('/src/e2e/rendererComparisonHarness.ts');
      harness.mountRendererComparisonHarness(document.body, engine);
    }, renderer);

    const viewer = page.locator('.hall-viewer-canvas');
    await expect(viewer).toHaveAttribute('data-floor-seat-count', '28908');
    await expect(viewer).toHaveAttribute(
      'data-seat-renderer',
      renderer === 'webgl' ? 'external' : 'canvas',
    );
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
    const bounds = await page
      .locator('#renderer-comparison-stage')
      .boundingBox();
    if (!bounds) throw new Error('Missing renderer comparison stage');

    const frameSamples = measureFrameIntervals(page, 180);
    await page.evaluate(() => {
      const windowWithObserver = window as Window & {
        __rendererComparisonLongTasks?: number[];
        __rendererComparisonObserver?: PerformanceObserver;
      };
      windowWithObserver.__rendererComparisonLongTasks = [];
      const observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries())
          windowWithObserver.__rendererComparisonLongTasks?.push(
            entry.duration,
          );
      });
      observer.observe({ type: 'longtask', buffered: false });
      windowWithObserver.__rendererComparisonObserver = observer;
    });
    await page.mouse.move(bounds.x + 250, bounds.y + 220);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 550, bounds.y + 220, { steps: 45 });
    await page.mouse.up();
    const frames = await frameSamples;
    const longTasks = await page.evaluate(() => {
      const windowWithObserver = window as Window & {
        __rendererComparisonLongTasks?: number[];
        __rendererComparisonObserver?: PerformanceObserver;
      };
      windowWithObserver.__rendererComparisonObserver?.disconnect();
      delete windowWithObserver.__rendererComparisonObserver;
      const tasks = windowWithObserver.__rendererComparisonLongTasks ?? [];
      delete windowWithObserver.__rendererComparisonLongTasks;
      return tasks.map((duration) => Math.round(duration * 100) / 100);
    });
    results.push({
      renderer,
      rendererInfo,
      readyMs,
      viewportScale,
      renderNodes,
      panFrameP95Ms: Math.round(percentile(frames, 0.95) * 100) / 100,
      panFrameMaxMs: Math.round(Math.max(...frames) * 100) / 100,
      panFrameSamples: frames.length,
      panLongTasks: longTasks,
    });

    await page.evaluate(async () => {
      const harness = await import('/src/e2e/rendererComparisonHarness.ts');
      harness.unmountRendererComparisonHarness(document.body);
    });
  }

  expect(results).toHaveLength(2);
  expect(results[0]?.renderNodes).toBeGreaterThan(0);
  expect(results[1]?.renderNodes).toBe(0);
  await test.info().attach('renderer-comparison-50000', {
    body: JSON.stringify(
      {
        scenario: 'Canvas and WebGL on identical 50,000-seat data',
        buildMode: 'Vite development server',
        activeFloorSeatCount: 28_908,
        viewport: { width: 1280, height: 800 },
        results,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  console.log(`[renderer-comparison] ${JSON.stringify(results)}`);
});

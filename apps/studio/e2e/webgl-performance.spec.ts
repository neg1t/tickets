import { expect, test } from '@playwright/test';
import { classifyGpu } from './performance-metrics';

test('WebGL culls offscreen instances at 50,000 and 100,000 seats @performance', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');

  for (const seatCount of [50_000, 100_000]) {
    const result = await page.evaluate(async (count) => {
      const moduleUrl = new URL(
        '/src/e2e/webglHarness.ts',
        window.location.href,
      ).href;
      const harness = await import(moduleUrl);
      const mounted = await harness.mountWebGLPerformanceHarness(
        document.body,
        count,
      );
      return mounted;
    }, seatCount);

    if (!result.supported || !result.metrics) {
      test.skip(true, 'WebGL2 is not available in this browser');
      return;
    }

    expect(result.metrics.seatCount).toBe(seatCount);
    expect(result.metrics.drawCalls).toBeGreaterThan(0);
    expect(result.metrics.visibleInstances).toBeGreaterThan(0);
    expect(result.metrics.visibleInstances).toBeLessThan(seatCount);
    expect(result.metrics.singleStatusBytes).toBe(
      Float32Array.BYTES_PER_ELEMENT,
    );
    expect(result.metrics.singleStatusCalls).toBe(1);
    expect(result.metrics.bulkStatusBytes).toBeLessThanOrEqual(
      seatCount * Float32Array.BYTES_PER_ELEMENT,
    );
    expect(result.metrics.bulkStatusCalls).toBeLessThanOrEqual(1);
    const gpuClassification = classifyGpu(
      true,
      result.metrics.vendor,
      result.metrics.renderer,
    );
    const benchmarkReport = {
      ...result.metrics,
      gpu: {
        classification: gpuClassification,
        vendor: result.metrics.vendor,
        renderer: result.metrics.renderer,
      },
      gpuBudget: {
        status: 'not-enforced',
        reason:
          'This benchmark checks draw and buffer behavior, not frame-time budget',
      },
      devicePixelRatio: result.metrics.devicePixelRatio,
      buildRevision: process.env['GIT_SHA'] ?? null,
      buildId: process.env['GITHUB_SHA'] ?? process.env['GIT_SHA'] ?? null,
    };
    await test.info().attach(`webgl-${seatCount}-metrics.json`, {
      body: JSON.stringify(benchmarkReport, null, 2),
      contentType: 'application/json',
    });
    console.log(`[webgl-benchmark] ${JSON.stringify(benchmarkReport)}`);

    await page.evaluate(async () => {
      const moduleUrl = new URL(
        '/src/e2e/webglHarness.ts',
        window.location.href,
      ).href;
      const harness = await import(moduleUrl);
      harness.unmountWebGLPerformanceHarness(document.body);
    });
  }
});

import { expect, test } from '@playwright/test';

test('WebGL culls offscreen instances at 50,000 and 100,000 seats', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');

  for (const seatCount of [50_000, 100_000]) {
    const result = await page.evaluate(async (count) => {
      const harness = await import('/src/e2e/webglHarness.ts');
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
    await test.info().attach(`webgl-${seatCount}-metrics.json`, {
      body: JSON.stringify(result.metrics, null, 2),
      contentType: 'application/json',
    });
    console.log(`[webgl-benchmark] ${JSON.stringify(result.metrics)}`);

    await page.evaluate(async () => {
      const harness = await import('/src/e2e/webglHarness.ts');
      harness.unmountWebGLPerformanceHarness(document.body);
    });
  }
});

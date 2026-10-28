import { expect, test } from '@playwright/test';

test('moves one WebGL seat without replacing its canvas or rebuilding the scene', async ({
  page,
}) => {
  await page.goto('/');
  const mounted = await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/webglIncrementalSceneHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    return harness.mountWebGLIncrementalSceneHarness(document.body);
  });
  if (!mounted.supported) {
    test.skip(true, 'WebGL2 is not available in this browser');
    return;
  }

  const canvas = page.locator('canvas[data-renderer="webgl2"]');
  await expect(canvas).toHaveAttribute('data-scene-revision', '1');
  await expect(canvas).toHaveAttribute('data-full-scene-builds', '1');
  await expect(canvas).toHaveAttribute('data-full-buffer-uploads', '8');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/webglIncrementalSceneHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.rememberWebGLIncrementalSceneCanvas();
    harness.moveWebGLIncrementalTestSeat();
  });

  await expect(canvas).toHaveAttribute('data-scene-revision', '2');
  await expect(canvas).toHaveAttribute('data-full-scene-builds', '1');
  await expect(canvas).toHaveAttribute('data-incremental-scene-updates', '1');
  await expect(canvas).toHaveAttribute('data-full-buffer-uploads', '8');
  expect(
    await page.evaluate(async () => {
      const moduleUrl = new URL(
        '/src/e2e/webglIncrementalSceneHarness.ts',
        window.location.href,
      ).href;
      const harness = await import(moduleUrl);
      return harness.isWebGLIncrementalSceneCanvasStable();
    }),
  ).toBe(true);

  for (const count of [1, 100, 1_000]) {
    const partialUploads = Number(
      await canvas.getAttribute('data-partial-buffer-uploads'),
    );
    await page.evaluate(async (seatCount) => {
      const moduleUrl = new URL(
        '/src/e2e/webglIncrementalSceneHarness.ts',
        window.location.href,
      ).href;
      const harness = await import(moduleUrl);
      harness.updateWebGLIncrementalTestAvailability(seatCount);
    }, count);
    await expect(canvas).toHaveAttribute(
      'data-partial-buffer-uploads',
      String(partialUploads + 1),
    );
    await expect(canvas).toHaveAttribute('data-full-scene-builds', '1');
    await expect(canvas).toHaveAttribute('data-scene-revision', '2');
    await expect(canvas).toHaveAttribute('data-full-buffer-uploads', '8');
  }

  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/webglIncrementalSceneHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.unmountWebGLIncrementalSceneHarness(document.body);
  });
});

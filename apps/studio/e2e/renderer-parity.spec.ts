import { expect, test } from '@playwright/test';

test('auto renderer keeps Canvas disabled until the rollout flag is on', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/hallViewportHarness.ts');
    harness.mountHallViewportHarness(document.body, 'auto');
  });

  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __hallRendererMode?: string }).__hallRendererMode,
    ),
  ).toBe('canvas');
});

test('forced WebGL replaces only the seat layer and preserves CPU picking', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/hallViewportHarness.ts');
    harness.mountHallViewportHarness(document.body, 'webgl');
  });

  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'external',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();
  const seatPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '.hall-viewer-canvas',
    );
    const testWindow = window as Window & {
      __hallSeatWorld?: { x: number; y: number };
      __hallSeatId?: string;
    };
    if (!container || !testWindow.__hallSeatWorld)
      throw new Error('Missing HallViewport test fixture');
    const bounds = container.getBoundingClientRect();
    const x = Number(container.dataset.viewportX);
    const y = Number(container.dataset.viewportY);
    const scale = Number(container.dataset.viewportScale);
    return {
      x: bounds.left + x + testWindow.__hallSeatWorld.x * scale,
      y: bounds.top + y + testWindow.__hallSeatWorld.y * scale,
    };
  });
  await page.mouse.click(seatPoint.x, seatPoint.y);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __hallClickTarget?: { kind: string; id: string } | null;
            }
          ).__hallClickTarget,
      ),
    )
    .toMatchObject({ kind: 'seat' });
});

test('falls back to Konva when WebGL2 context creation fails', async ({
  page,
}) => {
  await page.addInitScript({
    content: `(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind === 'webgl2') return null;
        return original.call(this, kind, ...args);
      };
    })();`,
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/hallViewportHarness.ts');
    harness.mountHallViewportHarness(document.body, 'webgl');
  });

  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __hallRendererError?: string })
          .__hallRendererError,
    ),
  ).toBe('WebGL2 is not available for this canvas');
});

test('restores once and falls back after the context is lost again', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/hallViewportHarness.ts');
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  const canvas = page.locator('canvas[data-renderer="webgl2"]');
  await expect(canvas).toBeVisible();

  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    if (!target) throw new Error('WebGL canvas was not mounted');
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    target.dispatchEvent(new Event('webglcontextrestored'));
  });
  await expect(canvas).toBeVisible();
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'external',
  );

  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    if (!target) throw new Error('WebGL canvas was not mounted');
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(0);
});

test('falls back to Konva if context restoration cannot rebuild shaders', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/hallViewportHarness.ts');
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();

  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    const context = target?.getContext('webgl2');
    if (!target || !context) throw new Error('WebGL context was not mounted');
    context.createShader = () => null;
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    target.dispatchEvent(new Event('webglcontextrestored'));
  });

  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __hallRendererError?: string })
          .__hallRendererError,
    ),
  ).toBe('Unable to allocate WebGL shader');
});

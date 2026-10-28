import { expect, test } from '@playwright/test';

test('auto renderer keeps Canvas disabled until the rollout flag is on', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
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
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __hallRendererMode?: string })
            .__hallRendererMode,
      ),
    )
    .toBe('webgl');

  expect(
    await page.evaluate(() => {
      const testWindow = window as Window & {
        __hallRendererTransitions?: Array<{
          engine: string;
          seatRenderer: string | null;
        }>;
      };
      return testWindow.__hallRendererTransitions?.[0] ?? null;
    }),
  ).toEqual({ engine: 'webgl', seatRenderer: 'canvas' });

  await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'external',
  );
  expect(
    await page
      .locator('.hall-viewer-canvas')
      .evaluate((container) =>
        [...container.children].map((child) =>
          child.id === 'renderer-parity-stage'
            ? 'base'
            : child.id === 'renderer-parity-stage-overlays'
              ? 'overlays'
              : child.hasAttribute('data-seat-renderer-layer')
                ? 'seats'
                : child.tagName.toLowerCase(),
        ),
      ),
  ).toEqual(['base', 'seats', 'overlays']);
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

test('resizes WebGL and Konva surfaces together when the viewport changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  const container = page.locator('.hall-viewer-canvas');
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();
  await expect(container).toHaveAttribute('data-seat-renderer', 'external');

  await container.evaluate((element) => {
    element.style.width = '620px';
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewer = document.querySelector<HTMLElement>(
          '.hall-viewer-canvas',
        );
        const webgl = document.querySelector<HTMLCanvasElement>(
          'canvas[data-renderer="webgl2"]',
        );
        const labels = document.querySelector<HTMLCanvasElement>(
          'canvas[data-renderer="seat-labels"]',
        );
        const stage = document.querySelector<HTMLCanvasElement>(
          '#renderer-parity-stage canvas',
        );
        const overlays = document.querySelector<HTMLCanvasElement>(
          '#renderer-parity-stage-overlays canvas',
        );
        if (!viewer || !webgl || !labels || !stage || !overlays) return null;
        return [
          viewer.clientWidth,
          webgl.width,
          labels.width,
          stage.width,
          overlays.width,
        ];
      }),
    )
    .toEqual([620, 620, 620, 620, 620]);
});

test('keeps editing available through context loss and restores the latest document', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl', true);
  });
  const webgl = page.locator('canvas[data-renderer="webgl2"]');
  const viewer = page.locator('.hall-viewer-canvas');
  await expect(webgl).toBeVisible();
  const originalSceneRevision = await viewer.getAttribute('data-scene-revision');

  const seatPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '.hall-viewer-canvas',
    );
    const testWindow = window as Window & {
      __hallSeatWorld?: { x: number; y: number };
    };
    if (!container || !testWindow.__hallSeatWorld)
      throw new Error('Missing HallViewport test fixture');
    const bounds = container.getBoundingClientRect();
    const scale = Number(container.dataset.viewportScale);
    return {
      x:
        bounds.left +
        Number(container.dataset.viewportX) +
        testWindow.__hallSeatWorld.x * scale,
      y:
        bounds.top +
        Number(container.dataset.viewportY) +
        testWindow.__hallSeatWorld.y * scale,
    };
  });
  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.down();
  await page.mouse.move(seatPoint.x + 30, seatPoint.y + 12, { steps: 4 });
  await expect(viewer).toHaveAttribute('data-preview-moving-seats', '1');

  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    if (!target) throw new Error('WebGL canvas was not mounted');
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await expect(viewer).toHaveAttribute('data-seat-renderer', 'canvas');
  await expect(viewer).toHaveAttribute('data-moving-target-count', '1');
  await expect(viewer).toHaveAttribute('data-pointer-mode', 'edit');
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __hallMoveCommitCount?: number })
            .__hallMoveCommitCount,
      ),
    )
    .toBe(1);

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __replaceHallDocument?: () => void;
    };
    if (!testWindow.__replaceHallDocument)
      throw new Error('Document replacement control was not mounted');
    testWindow.__replaceHallDocument();
  });
  await expect(viewer).toHaveAttribute('data-floor-seat-count', '23');
  await expect(viewer).toHaveAttribute('data-seat-renderer', 'canvas');
  await expect
    .poll(() => viewer.getAttribute('data-scene-revision'))
    .not.toBe(originalSceneRevision);
  await expect(webgl).toBeVisible();
  await expect(viewer).toHaveAttribute('data-seat-renderer', 'external');
});

test('sizes WebGL, labels, and Konva backing stores at DPR 2', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await page.evaluate(async () => {
      const moduleUrl = new URL(
        '/src/e2e/hallViewportHarness.ts',
        window.location.href,
      ).href;
      const harness = await import(moduleUrl);
      harness.mountHallViewportHarness(document.body, 'webgl');
    });
    await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();
    const surfaces = await page.evaluate(() => {
      const selectors = [
        'canvas[data-renderer="webgl2"]',
        'canvas[data-renderer="seat-labels"]',
        '#renderer-parity-stage canvas',
        '#renderer-parity-stage-overlays canvas',
      ];
      return selectors.flatMap((selector) => {
        const canvas = document.querySelector<HTMLCanvasElement>(selector);
        if (!canvas) return [];
        const bounds = canvas.getBoundingClientRect();
        return [{
          selector,
          backing: [canvas.width, canvas.height],
          css: [bounds.width, bounds.height],
        }];
      });
    });
    expect(surfaces).toHaveLength(4);
    expect(surfaces.map(({ backing }) => backing)).toEqual(
      surfaces.map(({ css }) => [
        Math.round(Math.round(css[0] ?? 0) * 2),
        Math.round(Math.round(css[1] ?? 0) * 2),
      ]),
    );
  } finally {
    await context.close();
  }
});

test('matches Canvas seat fill at the same seat center', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, {
      apply(target, thisArg, args: unknown[]) {
        const [kind, options] = args;
        if (kind !== 'webgl2') return Reflect.apply(target, thisArg, args);
        return Reflect.apply(target, thisArg, [
          kind,
          {
            ...(typeof options === 'object' && options !== null ? options : {}),
            preserveDrawingBuffer: true,
          },
        ]);
      },
    });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.classList.add('hall-theme-canvas');
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'canvas');
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.body)
        .getPropertyValue('--hall-canvas-seat')
        .trim(),
    ),
  ).toBe('#57b8d5');
  const readCanvasFill = () =>
    page.evaluate(() => {
      const container = document.querySelector<HTMLElement>(
        '.hall-viewer-canvas',
      );
      const stage = document.querySelector<HTMLElement>(
        '#renderer-parity-stage',
      );
      const testWindow = window as Window & {
        __hallSeatWorld?: { x: number; y: number };
      };
      if (!container || !stage || !testWindow.__hallSeatWorld)
        throw new Error('Missing Canvas parity fixture');
      const x =
        Number(container.dataset.viewportX) +
        testWindow.__hallSeatWorld.x * Number(container.dataset.viewportScale);
      const y =
        Number(container.dataset.viewportY) +
        testWindow.__hallSeatWorld.y * Number(container.dataset.viewportScale);
      const pixels = [...stage.querySelectorAll('canvas')].flatMap((canvas) => {
        const context = canvas.getContext('2d');
        if (!context || canvas.clientWidth === 0 || canvas.clientHeight === 0)
          return [];
        const pixelRatio = canvas.width / canvas.clientWidth;
        const pixel = context.getImageData(
          Math.floor(x * pixelRatio),
          Math.floor(y * pixelRatio),
          1,
          1,
        ).data;
        return pixel[3] === 0 ? [] : [[pixel[0], pixel[1], pixel[2], pixel[3]]];
      });
      return (
        pixels.find(
          ([red, green, blue]) => red === 87 && green === 184 && blue === 213,
        ) ?? null
      );
    });
  await expect.poll(readCanvasFill).not.toBeNull();
  const canvasFill = await readCanvasFill();
  expect(canvasFill).toEqual([87, 184, 213, 255]);

  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.unmountHallViewportHarness(document.body);
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  const webgl = page.locator('canvas[data-renderer="webgl2"]');
  await expect(webgl).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const webglFill = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '.hall-viewer-canvas',
    );
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    const testWindow = window as Window & {
      __hallSeatWorld?: { x: number; y: number };
    };
    const gl = canvas?.getContext('webgl2');
    if (!container || !canvas || !testWindow.__hallSeatWorld || !gl)
      throw new Error('Missing WebGL parity fixture');
    const x =
      Number(container.dataset.viewportX) +
      testWindow.__hallSeatWorld.x * Number(container.dataset.viewportScale);
    const y =
      Number(container.dataset.viewportY) +
      testWindow.__hallSeatWorld.y * Number(container.dataset.viewportScale);
    const pixel = new Uint8Array(4);
    gl.finish();
    gl.readPixels(
      Math.floor(x),
      canvas.height - Math.floor(y),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return [...pixel];
  });
  expect(webglFill.slice(0, 3)).toEqual(canvasFill?.slice(0, 3));
});

test('passes the resolved CSS selection color to the WebGL shader', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.uniform4f;
    const targetWindow = window as Window & {
      __selectedColorUniforms?: number[][];
    };
    targetWindow.__selectedColorUniforms = [];
    WebGL2RenderingContext.prototype.uniform4f = function (
      location,
      red,
      green,
      blue,
      alpha,
    ) {
      targetWindow.__selectedColorUniforms?.push([red, green, blue, alpha]);
      return original.call(this, location, red, green, blue, alpha);
    };
  });
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.style.setProperty('--hall-canvas-selected', '#12d687');
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & { __selectedColorUniforms?: number[][] }
        ).__selectedColorUniforms?.some(
          ([red, green, blue, alpha]) =>
            Math.abs((red ?? 0) - 18 / 255) < 0.001 &&
            Math.abs((green ?? 0) - 214 / 255) < 0.001 &&
            Math.abs((blue ?? 0) - 135 / 255) < 0.001 &&
            alpha === 1,
        ),
      ),
    )
    .toBe(true);
});

test('editor drag previews move WebGL seat buffers and commit once on release', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl', true);
  });
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toBeVisible();
  const seatPoint = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(
      '.hall-viewer-canvas',
    );
    const testWindow = window as Window & {
      __hallSeatWorld?: { x: number; y: number };
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

  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.down();
  await page.mouse.move(seatPoint.x + 30, seatPoint.y + 12, { steps: 4 });
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveAttribute(
    'data-preview-seats',
    '1',
  );
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-preview-moving-seats',
    '1',
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __hallMoveDelta?: { x: number; y: number } | null;
            }
          ).__hallMoveDelta,
      ),
    )
    .toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __hallMoveCommitCount?: number })
          .__hallMoveCommitCount,
    ),
  ).toBe(1);
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveAttribute(
    'data-preview-seats',
    '0',
  );
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-preview-moving-seats',
    '0',
  );
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
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl');
  });

  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __hallRendererError?: string })
            .__hallRendererError,
      ),
    )
    .toBe('WebGL2 is not available for this canvas');
});

test('falls back immediately on context loss and recovers only after a draw', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
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
  });
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );

  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    if (!target) throw new Error('WebGL canvas was not mounted');
    target.dispatchEvent(new Event('webglcontextrestored'));
  });
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'external',
  );
  await expect(canvas).toBeVisible();

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
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(1);
});

test('keeps the Canvas fallback when a lost context never restores', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
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
  });

  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(canvas).toHaveCount(1);
  await page.waitForTimeout(100);
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
});

test('recovers a real WebGL context loss and falls back after the next loss', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountHallViewportHarness(document.body, 'webgl');
  });
  const canvas = page.locator('canvas[data-renderer="webgl2"]');
  await expect(canvas).toBeVisible();
  const extensionAvailable = await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    return Boolean(
      target?.getContext('webgl2')?.getExtension('WEBGL_lose_context'),
    );
  });
  test.skip(!extensionAvailable, 'WEBGL_lose_context is unavailable');

  const restored = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const target = document.querySelector<HTMLCanvasElement>(
          'canvas[data-renderer="webgl2"]',
        );
        const context = target?.getContext('webgl2');
        const extension = context?.getExtension('WEBGL_lose_context');
        if (!target || !context || !extension) return resolve(false);
        const timeout = window.setTimeout(() => resolve(false), 4000);
        target.addEventListener(
          'webglcontextlost',
          () => window.setTimeout(() => extension.restoreContext(), 150),
          { once: true },
        );
        target.addEventListener(
          'webglcontextrestored',
          () => {
            window.clearTimeout(timeout);
            resolve(!context.isContextLost());
          },
          { once: true },
        );
        extension.loseContext();
      }),
  );
  expect(restored).toBe(true);
  await expect(canvas).toBeVisible();
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'external',
  );

  await page.evaluate(() => {
    const target = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    target
      ?.getContext('webgl2')
      ?.getExtension('WEBGL_lose_context')
      ?.loseContext();
  });
  await expect(page.locator('.hall-viewer-canvas')).toHaveAttribute(
    'data-seat-renderer',
    'canvas',
  );
  await expect(page.locator('canvas[data-renderer="webgl2"]')).toHaveCount(1);
});

test('falls back to Konva if context restoration cannot rebuild shaders', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/hallViewportHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
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

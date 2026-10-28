import { expect, test } from '@playwright/test';
import { waitForPaint } from './performance-metrics';

test('keeps the WebGL control seat aligned with the shared camera revision @performance', async ({
  page,
}) => {
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
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.evaluate(async () => {
    const moduleUrl = new URL(
      '/src/e2e/rendererComparisonHarness.ts',
      window.location.href,
    ).href;
    const harness = await import(moduleUrl);
    harness.mountRendererComparisonHarness(document.body, 'webgl');
  });

  const viewer = page.locator('.hall-viewer-canvas');
  const webglCanvas = page.locator('canvas[data-renderer="webgl2"]');
  await expect(viewer).toHaveAttribute('data-seat-renderer-engine', 'webgl');
  await expect(webglCanvas).toBeVisible();
  await expect(viewer).toHaveAttribute('data-camera-revision', /^\d+$/);
  await expect(webglCanvas).toHaveAttribute('data-camera-revision', /^\d+$/);

  const stageBounds = await page
    .locator('#renderer-comparison-stage')
    .boundingBox();
  if (!stageBounds) throw new Error('Missing renderer comparison stage bounds');
  const controlSeat = await page.evaluate(() => {
    const testWindow = window as Window & {
      __rendererComparisonControlSeat?: { id: string; x: number; y: number };
    };
    return testWindow.__rendererComparisonControlSeat ?? null;
  });
  if (!controlSeat) throw new Error('Missing WebGL camera control seat');
  const dragBounds = await page
    .locator('#renderer-comparison-stage')
    .boundingBox();
  if (!dragBounds) throw new Error('Missing renderer comparison stage bounds');
  await page.mouse.move(dragBounds.x + 500, dragBounds.y + 400);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      dragBounds.x + 500 - step,
      dragBounds.y + 400 - step * 2,
    );
    await waitForPaint(page, 2);
    const revisions = await page.evaluate(() => ({
      viewer: document.querySelector<HTMLElement>('.hall-viewer-canvas')
        ?.dataset.cameraRevision,
      webgl: document.querySelector<HTMLCanvasElement>(
        'canvas[data-renderer="webgl2"]',
      )?.dataset.cameraRevision,
    }));
    expect(revisions.viewer).toBeTruthy();
    expect(revisions.webgl).toBe(revisions.viewer);
  }
  await page.mouse.up();
  await waitForPaint(page, 2);

  const viewerBounds = await viewer.boundingBox();
  if (!viewerBounds) throw new Error('Missing WebGL viewer bounds');
  const position = await viewer.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      x: Number(dataset.viewportX),
      y: Number(dataset.viewportY),
      scale: Number(dataset.viewportScale),
    };
  });
  const targetX = viewerBounds.x + position.x + controlSeat.x * position.scale;
  const targetY = viewerBounds.y + position.y + controlSeat.y * position.scale;
  const panDelta = {
    x: viewerBounds.x + viewerBounds.width / 2 - targetX,
    y: viewerBounds.y + viewerBounds.height / 2 - targetY,
  };
  if (Math.abs(panDelta.x) > 0.25 || Math.abs(panDelta.y) > 0.25) {
    const start = {
      x: stageBounds.x + stageBounds.width * 0.25,
      y: stageBounds.y + stageBounds.height * 0.25,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + panDelta.x, start.y + panDelta.y, {
      steps: 4,
    });
    await page.mouse.up();
    await waitForPaint(page, 2);
  }
  for (let zoomStep = 0; zoomStep < 24; zoomStep += 1)
    await page.getByRole('button', { name: 'Увеличить' }).click();
  await waitForPaint(page, 2);
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeGreaterThan(5);
  const zoomedViewerBounds = await viewer.boundingBox();
  if (!zoomedViewerBounds)
    throw new Error('Missing zoomed WebGL viewer bounds');
  const zoomedPosition = await viewer.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      x: Number(dataset.viewportX),
      y: Number(dataset.viewportY),
      scale: Number(dataset.viewportScale),
    };
  });
  const zoomPanDelta = {
    x:
      zoomedViewerBounds.width / 2 -
      (zoomedPosition.x + controlSeat.x * zoomedPosition.scale),
    y:
      zoomedViewerBounds.height / 2 -
      (zoomedPosition.y + controlSeat.y * zoomedPosition.scale),
  };
  if (Math.abs(zoomPanDelta.x) > 0.25 || Math.abs(zoomPanDelta.y) > 0.25) {
    const start = {
      x: zoomedViewerBounds.x + zoomedViewerBounds.width * 0.25,
      y: zoomedViewerBounds.y + zoomedViewerBounds.height * 0.25,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + zoomPanDelta.x, start.y + zoomPanDelta.y, {
      steps: 4,
    });
    await page.mouse.up();
    await waitForPaint(page, 2);
  }
  const finalControlPoint = await viewer.evaluate((element, seat) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      x: Number(dataset.viewportX) + seat.x * Number(dataset.viewportScale),
      y: Number(dataset.viewportY) + seat.y * Number(dataset.viewportScale),
      width: element.clientWidth,
      height: element.clientHeight,
    };
  }, controlSeat);
  expect(
    Math.abs(finalControlPoint.x - finalControlPoint.width / 2),
  ).toBeLessThan(2);
  expect(
    Math.abs(finalControlPoint.y - finalControlPoint.height / 2),
  ).toBeLessThan(2);
  const zoomedRevisions = await page.evaluate(() => ({
    viewer: document.querySelector<HTMLElement>('.hall-viewer-canvas')?.dataset
      .cameraRevision,
    webgl: document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    )?.dataset.cameraRevision,
  }));
  expect(zoomedRevisions.webgl).toBe(zoomedRevisions.viewer);

  const cameraPixels = await page.evaluate(() => {
    const viewerElement = document.querySelector<HTMLElement>(
      '.hall-viewer-canvas',
    );
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="webgl2"]',
    );
    const testWindow = window as Window & {
      __rendererComparisonControlSeat?: { id: string; x: number; y: number };
    };
    const seat = testWindow.__rendererComparisonControlSeat;
    const context = canvas?.getContext('webgl2', {
      preserveDrawingBuffer: true,
    });
    if (!viewerElement || !canvas || !seat || !context)
      throw new Error('Missing WebGL camera control pixel');
    const x =
      Number(viewerElement.dataset.viewportX) +
      seat.x * Number(viewerElement.dataset.viewportScale);
    const y =
      Number(viewerElement.dataset.viewportY) +
      seat.y * Number(viewerElement.dataset.viewportScale);
    const ratio = canvas.width / canvas.clientWidth;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    context.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixels,
    );
    let count = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let pixelY = 0; pixelY < canvas.height; pixelY += 1) {
      for (let pixelX = 0; pixelX < canvas.width; pixelX += 1) {
        const index = (pixelY * canvas.width + pixelX) * 4;
        if (
          (pixels[index] ?? 0) > 160 &&
          (pixels[index + 1] ?? 0) < 100 &&
          (pixels[index + 2] ?? 0) > 160 &&
          (pixels[index + 3] ?? 0) > 200
        ) {
          count += 1;
          minX = Math.min(minX, pixelX);
          minY = Math.min(minY, pixelY);
          maxX = Math.max(maxX, pixelX);
          maxY = Math.max(maxY, pixelY);
        }
      }
    }
    return {
      expectedX: x * ratio,
      expectedY: canvas.height - 1 - y * ratio,
      minX,
      minY,
      maxX,
      maxY,
      count,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      ratio,
      viewport: {
        x: viewerElement.dataset.viewportX,
        y: viewerElement.dataset.viewportY,
        scale: viewerElement.dataset.viewportScale,
      },
      seat,
    };
  });
  expect(cameraPixels.count, JSON.stringify(cameraPixels)).toBeGreaterThan(0);
  expect(
    Math.abs(
      (cameraPixels.minX + cameraPixels.maxX) / 2 - cameraPixels.expectedX,
    ),
  ).toBeLessThan(6);
  expect(
    Math.abs(
      (cameraPixels.minY + cameraPixels.maxY) / 2 - cameraPixels.expectedY,
    ),
  ).toBeLessThan(6);
});

import { expect, test } from '@playwright/test';

test('WebGL renderer draws seats, updates styles, and dispatches CPU picks', async ({
  page,
}) => {
  await page.goto('/');
  const mounted = await page.evaluate(async () => {
    const harness = await import('/src/e2e/webglHarness.ts');
    return harness.mountWebGLTestHarness(document.body);
  });
  if (!mounted.supported) {
    test.skip(true, mounted.message);
    return;
  }

  const readPixel = (x = 320, y = 240) =>
    page.evaluate(
      ({ screenX, screenY }) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[data-webgl-test-canvas="true"]',
        );
        const gl = canvas?.getContext('webgl2');
        if (!canvas || !gl) throw new Error('WebGL test canvas disappeared');
        gl.finish();
        const pixel = new Uint8Array(4);
        gl.readPixels(
          Math.floor(screenX),
          canvas.height - Math.floor(screenY),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return [...pixel];
      },
      { screenX: x, screenY: y },
    );

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const availablePixel = await readPixel();
  expect(availablePixel[3]).toBeGreaterThan(0);

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __webglTestRenderer?: {
        updateSeats(updates: readonly { id: string; status: string }[]): void;
        emitPick(point: { x: number; y: number }): void;
      };
    };
    testWindow.__webglTestRenderer?.updateSeats([
      { id: 'webgl-seat-center', status: 'sold' },
    ]);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const soldPixel = await readPixel();
  expect(soldPixel).not.toEqual(availablePixel);

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __webglTestRenderer?: {
        setSelection(targets: readonly { kind: string; id: string }[]): void;
      };
    };
    testWindow.__webglTestRenderer?.setSelection([
      { kind: 'seat', id: 'webgl-seat-center' },
    ]);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  const selectedOutlinePixel = await readPixel(320, 159);
  expect(selectedOutlinePixel[2]).toBeGreaterThan(selectedOutlinePixel[0]);

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __webglTestRenderer?: { emitPick(point: { x: number; y: number }): void };
    };
    testWindow.__webglTestRenderer?.emitPick({ x: 320, y: 240 });
  });
  const events = await page.evaluate(() => {
    const testWindow = window as Window & {
      __webglTestEvents?: readonly { type: string; target?: { id: string } }[];
    };
    return testWindow.__webglTestEvents ?? [];
  });
  expect(events.at(-1)).toMatchObject({
    type: 'pick',
    target: { id: 'webgl-seat-center' },
  });
});

test('WebGL canvas keeps seat labels on a visible-area 2D overlay', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/webglHarness.ts');
    harness.mountWebGLLabelsHarness(document.body);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  const labelPixelCount = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-renderer="seat-labels"]',
    );
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('Missing seat label canvas');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let alpha = 3; alpha < pixels.length; alpha += 4)
      if ((pixels[alpha] ?? 0) > 0) count += 1;
    return count;
  });

  expect(labelPixelCount).toBeGreaterThan(0);
  await page.evaluate(async () => {
    const harness = await import('/src/e2e/webglHarness.ts');
    harness.unmountWebGLLabelsHarness(document.body);
  });
});

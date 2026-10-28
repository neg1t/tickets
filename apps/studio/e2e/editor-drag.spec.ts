import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createPerformanceHallDraft } from '@hall-platform/fixtures';
import { openCurrentEditor } from './navigation';
import { waitForPaint } from './performance-metrics';

type ExportedSeat = {
  id: string;
  position: { x: number; y: number };
  placement?: { kind: string; rowId?: string };
};

function seatAt(seats: readonly ExportedSeat[], index: number): ExportedSeat {
  const seat = seats[index];
  if (!seat) throw new Error(`Missing seat ${index}`);
  return seat;
}

async function boundingBoxOf(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Missing bounding box');
  return bounds;
}

async function exportSeats(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  const draft = JSON.parse(
    await readFile(await (await download).path(), 'utf8'),
  );
  return draft.snapshot.seats as ExportedSeat[];
}

async function hasSelectionStrokeNear(
  page: Page,
  point: Readonly<{ x: number; y: number }>,
) {
  return page.evaluate(({ x, y }) => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      '#hall-stage canvas',
    )) {
      const context = canvas.getContext('2d');
      if (!context) continue;
      const bounds = canvas.getBoundingClientRect();
      const ratioX = canvas.width / bounds.width;
      const ratioY = canvas.height / bounds.height;
      for (const offsetY of [-1, 0, 1]) {
        for (const offsetX of [-1, 0, 1]) {
          const pixelX = Math.floor((x + offsetX - bounds.left) * ratioX);
          const pixelY = Math.floor((y + offsetY - bounds.top) * ratioY);
          if (
            pixelX < 0 ||
            pixelY < 0 ||
            pixelX >= canvas.width ||
            pixelY >= canvas.height
          )
            continue;
          const [red = 0, green = 0, blue = 0, alpha = 0] =
            context.getImageData(pixelX, pixelY, 1, 1).data;
          if (
            alpha > 80 &&
            red > 170 &&
            green > 70 &&
            green < 190 &&
            blue < 120
          )
            return true;
        }
      }
    }
    return false;
  }, point);
}

async function hasSeatFillNear(
  page: Page,
  point: Readonly<{ x: number; y: number }>,
) {
  return page.evaluate(({ x, y }) => {
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(
      '#hall-stage canvas',
    )) {
      const context = canvas.getContext('2d');
      if (!context) continue;
      const bounds = canvas.getBoundingClientRect();
      const ratioX = canvas.width / bounds.width;
      const ratioY = canvas.height / bounds.height;
      const pixelX = Math.floor((x - bounds.left) * ratioX);
      const pixelY = Math.floor((y - bounds.top) * ratioY);
      if (
        pixelX < 0 ||
        pixelY < 0 ||
        pixelX >= canvas.width ||
        pixelY >= canvas.height
      )
        continue;
      const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(
        pixelX,
        pixelY,
        1,
        1,
      ).data;
      if (alpha > 80 && red < 100 && green > 80 && blue > 100) return true;
    }
    return false;
  }, point);
}

test('moves two selected seats in one commit and one undo step', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 450, y: 250 } });
  const before = await exportSeats(page);
  await stage.click({ position: { x: 400, y: 250 }, modifiers: ['Shift'] });
  await expect(page.getByText(/Выбрано: 2/)).toBeVisible();

  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  const beforePreview = await stage.screenshot();
  await page.mouse.move(bounds.x + 425, bounds.y + 250, { steps: 5 });
  const duringPreview = await stage.screenshot();
  expect(duringPreview.equals(beforePreview)).toBe(false);
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '2',
  );
  await page.mouse.up();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '3',
  );
  const moved = await exportSeats(page);
  expect(moved).toHaveLength(2);
  expect(
    seatAt(moved, 0).position.x - seatAt(before, 0).position.x,
  ).toBeCloseTo(seatAt(moved, 1).position.x - seatAt(before, 1).position.x);
  expect(seatAt(moved, 0).position.x).toBeGreaterThan(
    seatAt(before, 0).position.x,
  );

  await page.getByRole('button', { name: 'Отменить' }).click();
  expect(await exportSeats(page)).toEqual(before);
  await page.getByRole('button', { name: 'Повторить' }).click();
  expect(await exportSeats(page)).toEqual(moved);
});

test('keeps a selected circular seat outline aligned during drag preview', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 450, y: 320 } });
  const seats = await exportSeats(page);
  const seat = seatAt(seats, 0);

  const viewer = page.locator('.hall-viewer-canvas');
  const viewerBounds = await boundingBoxOf(viewer);
  const viewport = await viewer.evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      x: Number(data.viewportX),
      y: Number(data.viewportY),
      scale: Number(data.viewportScale),
    };
  });
  const seatPoint = {
    x: viewerBounds.x + viewport.x + seat.position.x * viewport.scale,
    y: viewerBounds.y + viewport.y + seat.position.y * viewport.scale,
  };
  expect(
    await hasSeatFillNear(page, {
      x: seatPoint.x + 0.3 * viewport.scale,
      y: seatPoint.y + 0.2 * viewport.scale,
    }),
  ).toBe(true);
  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.click(seatPoint.x, seatPoint.y);
  await expect(page.getByText(/Выбрано: 1/)).toBeVisible();

  const dragDelta = 24;
  const selectionRadius = 0.75 * viewport.scale;
  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.down();
  await page.mouse.move(seatPoint.x + dragDelta, seatPoint.y, { steps: 4 });
  await waitForPaint(page, 2);

  expect(
    await hasSelectionStrokeNear(page, {
      x: seatPoint.x + dragDelta + selectionRadius,
      y: seatPoint.y,
    }),
  ).toBe(true);
  expect(
    await hasSelectionStrokeNear(page, {
      x: seatPoint.x + dragDelta * 2 + selectionRadius,
      y: seatPoint.y,
    }),
  ).toBe(false);

  await page.mouse.up();
});

test('previews and cancels a 180-seat row as one group transform', async ({
  page,
}) => {
  await page.goto('/');
  await openCurrentEditor(page);
  const seats = await exportSeats(page);
  const firstRowSeat = seats.find((seat) => seat.placement?.kind === 'row');
  if (!firstRowSeat) throw new Error('Missing a generated row seat');
  const viewer = page.locator('.hall-viewer-canvas');
  const stage = page.locator('#hall-stage');
  const viewport = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing stage bounds for row drag');
  const seatPoint = {
    x: bounds.x + viewport.x + firstRowSeat.position.x * viewport.scale,
    y: bounds.y + viewport.y + firstRowSeat.position.y * viewport.scale,
  };

  await page.mouse.move(seatPoint.x, seatPoint.y);
  await page.mouse.click(seatPoint.x, seatPoint.y);
  await page.getByRole('button', { name: /Выбрать ряд/ }).click();
  const seatCount = page.getByRole('spinbutton', { name: 'Мест в ряду' });
  await seatCount.fill('180');
  await seatCount.blur();
  await page.getByRole('button', { name: 'Применить места' }).click();
  await expect(page.locator('.hall-editor-header')).toContainText('200 мест');
  const beforeDrag = await exportSeats(page);
  expect(beforeDrag).toHaveLength(200);
  expect(
    beforeDrag.filter(
      (seat) => seat.placement?.rowId === firstRowSeat.placement?.rowId,
    ),
  ).toHaveLength(180);
  const movingSeat = beforeDrag.find((seat) => seat.placement?.kind === 'row');
  if (!movingSeat) throw new Error('Missing a seat after row regeneration');
  const currentViewport = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  const currentPoint = {
    x:
      bounds.x +
      currentViewport.x +
      movingSeat.position.x * currentViewport.scale,
    y:
      bounds.y +
      currentViewport.y +
      movingSeat.position.y * currentViewport.scale,
  };
  await page.mouse.move(currentPoint.x, currentPoint.y);
  await page.mouse.down();
  await expect(viewer).toHaveAttribute('data-moving-target-count', /18[01]/);
  await page.mouse.move(currentPoint.x + 18, currentPoint.y + 12, { steps: 3 });
  expect(
    Number(await viewer.getAttribute('data-seat-render-nodes')),
  ).toBeLessThan(1_000);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(viewer).toHaveAttribute('data-moving-target-count', '0');
  expect(await exportSeats(page)).toEqual(beforeDrag);
});

test('middle mouse pans while preserving the selected editor tool', async ({
  page,
}) => {
  await page.goto('/');
  await openCurrentEditor(page);
  const viewer = page.locator('.hall-viewer-canvas');
  const stage = page.locator('#hall-stage');
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing stage bounds for middle mouse pan');
  const initialX = Number(await viewer.getAttribute('data-viewport-x'));
  await page.mouse.move(bounds.x + 300, bounds.y + 220);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bounds.x + 340, bounds.y + 240, { steps: 3 });
  await page.mouse.up({ button: 'middle' });
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-x')))
    .toBeGreaterThan(initialX);
  await expect(viewer).toHaveAttribute('data-interaction-tool', 'select');
});

test('Space temporarily switches to pan and restores the selected tool', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const viewer = page.locator('.hall-viewer-canvas');
  await expect(viewer).toHaveAttribute('data-interaction-tool', 'select');

  await page.keyboard.down('Space');
  await expect(viewer).toHaveAttribute('data-interaction-tool', 'pan');
  await page.keyboard.up('Space');

  await expect(viewer).toHaveAttribute('data-interaction-tool', 'select');
});

test('preserves the camera center and scale when the editor resizes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openCurrentEditor(page);
  const viewer = page.locator('.hall-viewer-canvas');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const beforeBounds = await viewer.boundingBox();
  if (!beforeBounds) throw new Error('Missing viewer bounds before resize');
  const beforeRevision = Number(
    await viewer.getAttribute('data-camera-revision'),
  );
  const beforeViewport = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  };
  const centerBefore = {
    x: (beforeBounds.width / 2 - beforeViewport.x) / beforeViewport.scale,
    y: (beforeBounds.height / 2 - beforeViewport.y) / beforeViewport.scale,
  };

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(async () => (await viewer.boundingBox())?.width ?? 0)
    .toBeLessThan(beforeBounds.width);
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-camera-revision')))
    .toBeGreaterThan(beforeRevision);
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-scale')))
    .toBeCloseTo(beforeViewport.scale);
  const afterBounds = await viewer.boundingBox();
  if (!afterBounds) throw new Error('Missing viewer bounds after resize');
  const afterViewport = {
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
  };
  const centerAfter = {
    x: (afterBounds.width / 2 - afterViewport.x) / beforeViewport.scale,
    y: (afterBounds.height / 2 - afterViewport.y) / beforeViewport.scale,
  };

  expect(centerAfter.x).toBeCloseTo(centerBefore.x, 3);
  expect(centerAfter.y).toBeCloseTo(centerBefore.y, 3);
});

test('restores the saved camera when switching between floors', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const draft = createPerformanceHallDraft(5_000, 'multi-floor');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .last()
    .click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'floor-camera-layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    draft.hallName,
    { timeout: 60_000 },
  );
  await expect(page.getByText(/Подложка: отображается/)).toBeVisible({
    timeout: 30_000,
  });

  const viewer = page.locator('.hall-viewer-canvas');
  const floor = page.getByLabel('Этаж', { exact: true });
  const readCamera = async () => ({
    x: Number(await viewer.getAttribute('data-viewport-x')),
    y: Number(await viewer.getAttribute('data-viewport-y')),
    scale: Number(await viewer.getAttribute('data-viewport-scale')),
  });
  const initialScale = (await readCamera()).scale;
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await page.getByRole('button', { name: 'Увеличить' }).click();
  await expect
    .poll(async () => Number((await readCamera()).scale))
    .toBeGreaterThan(initialScale * 1.3);
  const firstFloorCamera = await readCamera();

  await floor.selectOption('f2');
  await expect(viewer).toHaveAttribute('data-floor-seat-count', /\d+/);
  const bounds = await page.locator('#hall-stage').boundingBox();
  if (!bounds) throw new Error('Missing stage bounds on second floor');
  await page.getByRole('button', { name: 'Рука' }).click();
  const beforePanX = (await readCamera()).x;
  await page.mouse.move(bounds.x + 300, bounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 350, bounds.y + 235, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number((await readCamera()).x))
    .toBeGreaterThan(beforePanX + 40);
  const secondFloorCamera = await readCamera();

  await floor.selectOption('f1');
  await expect
    .poll(
      async () => {
        const camera = await readCamera();
        return (
          Math.abs(camera.x - firstFloorCamera.x) < 1e-8 &&
          Math.abs(camera.y - firstFloorCamera.y) < 1e-8 &&
          Math.abs(camera.scale - firstFloorCamera.scale) < 1e-8
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await floor.selectOption('f2');
  await expect
    .poll(
      async () => {
        const camera = await readCamera();
        return (
          Math.abs(camera.x - secondFloorCamera.x) < 1e-8 &&
          Math.abs(camera.y - secondFloorCamera.y) < 1e-8 &&
          Math.abs(camera.scale - secondFloorCamera.scale) < 1e-8
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test('Escape cancels a preview without changing the draft or history', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 250, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '1',
  );
  expect(await exportSeats(page)).toEqual(before);
});

test('a tap and a zero-distance press do not create a move command', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  await stage.click({ position: { x: 400, y: 250 } });
  await expect(page.getByText(/Выбрано: 1/)).toBeVisible();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '1',
  );
  expect(await exportSeats(page)).toEqual(before);
});

test('dragging at the edge pans the viewport without an intermediate commit', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const viewer = page.locator('.hall-viewer-canvas');
  const before = Number(await viewer.getAttribute('data-viewport-x'));
  const bounds = (await stage.boundingBox()) as {
    x: number;
    y: number;
    width: number;
  };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + 250, {
    steps: 8,
  });
  await expect
    .poll(async () => Number(await viewer.getAttribute('data-viewport-x')))
    .toBeLessThan(before - 20);
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '1',
  );
  await page.mouse.up();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '2',
  );
});

test('replacing the hall during a drag cancels the old document gesture', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Сохранено локально' }).first(),
  ).toBeVisible();
  const bounds = (await stage.boundingBox()) as { x: number; y: number };
  await page.mouse.move(bounds.x + 400, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 450, bounds.y + 250, { steps: 4 });
  await page
    .getByRole('button', { name: 'Демо и обслуживание' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page
    .getByRole('menuitem', { name: 'Открыть тестовый зал' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('.studio-editor-title strong')).toHaveText(
    'Small Theater',
  );
  await page.mouse.up();
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '0',
  );
});

test('touch pointercancel discards a drag without changing the saved geometry', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  await stage.scrollIntoViewIfNeeded();
  const beforeImage = await stage.screenshot();
  const box = (await stage.boundingBox()) as { x: number; y: number };
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 400, y: box.y + 250, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: box.x + 450, y: box.y + 250, id: 1 }],
  });
  expect((await stage.screenshot()).equals(beforeImage)).toBe(false);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '1',
  );
  expect(await exportSeats(page)).toEqual(before);
  await context.close();
});

test('pen movement commits a seat once', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый зал' }).click();
  const stage = page.locator('#hall-stage');
  await page.getByRole('button', { name: 'Место', exact: true }).click();
  await stage.click({ position: { x: 400, y: 250 } });
  const before = await exportSeats(page);
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox()) as { x: number; y: number };
  const client = await page.context().newCDPSession(page);
  const point = { x: box.x + 400, y: box.y + 250 };
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'pen',
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x + 40,
    y: point.y,
    button: 'left',
    buttons: 1,
    pointerType: 'pen',
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x + 40,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'pen',
  });
  await expect(page.locator('.studio-editor-page')).toHaveAttribute(
    'data-change-count',
    '2',
  );
  expect(seatAt(await exportSeats(page), 0).position.x).toBeGreaterThan(
    seatAt(before, 0).position.x,
  );
});

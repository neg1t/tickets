import { test, expect } from '@playwright/test';
import { cpus, platform, totalmem } from 'node:os';
import { performance as nodePerformance } from 'node:perf_hooks';
import { createDraftFromSnapshot, layoutSnapshotSchema } from '@hall-platform/domain';
import { makeLargeHallFixture } from './largeHallFixture';
import { openBuyer } from './navigation';

test.skip(process.env['HALL_MEASURE_PERFORMANCE'] !== '1', 'Run explicitly against the production preview');

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

test('measures large editor open and pan', async ({ page }) => {
  test.setTimeout(180_000);
  const requestedSize = Number(process.env['HALL_FIXTURE_SIZE'] ?? '10000');
  if (requestedSize !== 1_000 && requestedSize !== 10_000 && requestedSize !== 50_000)
    throw new Error('HALL_FIXTURE_SIZE must be 1000, 10000, or 50000');
  const fixture = makeLargeHallFixture(requestedSize);
  const draft = createDraftFromSnapshot(`Arena ${requestedSize}`, layoutSnapshotSchema.parse(fixture.document.snapshot));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо и обслуживание' }).last().click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: `arena-${requestedSize}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.locator('#hall-stage')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'К списку залов' }).click();

  const stage = page.locator('#hall-stage');
  const openSamplesMs: number[] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const openedAt = nodePerformance.now();
    await page.locator('.hall-card', { hasText: draft.hallName }).getByRole('button', { name: 'Открыть черновик' }).click();
    await expect(stage).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    openSamplesMs.push(nodePerformance.now() - openedAt);
    if (sample < 2) await page.getByRole('button', { name: 'К списку залов' }).click();
  }

  await page.getByRole('button', { name: 'Рука' }).click();
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Missing stage bounds');
  const frameSamples = page.evaluate(() => new Promise<number[]>((resolve) => {
    const samples: number[] = [];
    let previous = performance.now();
    const tick = (now: number) => {
      samples.push(now - previous);
      previous = now;
      if (samples.length < 90) requestAnimationFrame(tick);
      else resolve(samples);
    };
    requestAnimationFrame(tick);
  }));
  await page.mouse.move(bounds.x + 250, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 550, bounds.y + 220, { steps: 45 });
  await page.mouse.up();
  const panFrames = await frameSamples;
  const longSession = process.env['HALL_EXTENDED_PERFORMANCE'] === '1'
    ? await (async () => {
        const heapBefore = await page.evaluate(() =>
          (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        );
        for (let cycle = 0; cycle < 20; cycle += 1) {
          await page.mouse.move(bounds.x + 250, bounds.y + 220);
          await page.mouse.down();
          await page.mouse.move(bounds.x + 550, bounds.y + 220, { steps: 6 });
          await page.mouse.up();
          await page.mouse.down();
          await page.mouse.move(bounds.x + 250, bounds.y + 220, { steps: 6 });
          await page.mouse.up();
        }
        const heapAfter = await page.evaluate(() =>
          (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
        );
        return { cycles: 20, heapBefore, heapAfter };
      })()
    : null;
  const browser = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
    heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  }));
  const result = {
    date: new Date().toISOString(),
    machine: { platform: platform(), cpu: cpus()[0]?.model, totalMemoryBytes: totalmem() },
    browser,
    viewport: { width: 1280, height: 800 },
    buildMode: 'Vite production preview',
    fixture: `Arena grid, ${requestedSize} seats, 250 columns`,
    openSamplesMs,
    openMedianMs: percentile(openSamplesMs, 0.5),
    panP95Ms: percentile(panFrames, 0.95),
    panMaxMs: Math.max(...panFrames),
    longSession,
  };
  const body = JSON.stringify(result, null, 2);
  await test.info().attach(`performance-${requestedSize}`, { body, contentType: 'application/json' });
  console.log(body);
  if (process.env['HALL_ENFORCE_BUDGET'] === '1') {
    if (requestedSize === 10_000) {
      expect(result.openMedianMs).toBeLessThanOrEqual(Number(process.env['HALL_OPEN_BUDGET_MS'] ?? '4000'));
      expect(result.panP95Ms).toBeLessThanOrEqual(Number(process.env['HALL_PAN_BUDGET_MS'] ?? '25'));
    }
    if (requestedSize === 50_000)
      expect(result.openMedianMs).toBeLessThanOrEqual(Number(process.env['HALL_50K_OPEN_BUDGET_MS'] ?? '25000'));
  }
});

test('measures buyer selection feedback', async ({ page }) => {
  await page.goto('/');
  await openBuyer(page);
  await expect(page.locator('.seat-view-seat-list button:not([disabled])').first()).toBeVisible();
  const samples = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('.seat-view-seat-list button:not([disabled])');
    if (!button) throw new Error('No selectable seat');
    const times: number[] = [];
    for (let sample = 0; sample < 20; sample += 1) {
      const before = button.getAttribute('aria-pressed');
      const elapsed = await new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error('Selection feedback timed out')); }, 1000);
        const observer = new MutationObserver(() => {
          if (button.getAttribute('aria-pressed') === before) return;
          window.clearTimeout(timer);
          observer.disconnect();
          resolve(performance.now() - started);
        });
        observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });
        button.click();
      });
      times.push(elapsed);
    }
    return times;
  });
  const result = { samplesMs: samples, p95Ms: percentile(samples, 0.95) };
  await test.info().attach('selection-feedback', {
    body: JSON.stringify(result, null, 2), contentType: 'application/json',
  });
  console.log(JSON.stringify(result));
  if (process.env['HALL_ENFORCE_BUDGET'] === '1')
    expect(result.p95Ms).toBeLessThanOrEqual(100);
});

test('measures group drag in a 10k-seat editor', async ({ page }) => {
  test.skip(process.env['HALL_EXTENDED_PERFORMANCE'] !== '1');
  test.setTimeout(120_000);
  const fixture = makeLargeHallFixture(10_000);
  const draft = createDraftFromSnapshot('Group drag 10k', layoutSnapshotSchema.parse(fixture.document.snapshot));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Демо и обслуживание' }).last().click();
  await page.getByLabel('Открыть JSON').setInputFiles({
    name: 'group-drag-10k.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draft)),
  });
  const stage = page.locator('#hall-stage');
  await expect(stage).toBeVisible();
  for (let step = 0; step < 6; step += 1)
    await page.getByRole('button', { name: 'Увеличить' }).click();
  const viewport = await page.locator('.hall-viewer-canvas').evaluate((element) => ({
    x: Number(element.getAttribute('data-viewport-x')),
    y: Number(element.getAttribute('data-viewport-y')),
    scale: Number(element.getAttribute('data-viewport-scale')),
  }));
  const box = await stage.boundingBox();
  if (!box) throw new Error('Stage bounds are missing');
  const worldX = Math.round(((box.width / 2 - viewport.x) / viewport.scale) / 2) * 2;
  const worldY = Math.max(0, Math.min(78,
    Math.round(((box.height / 2 - viewport.y) / viewport.scale) / 2) * 2));
  const first = {
    x: box.x + viewport.x + worldX * viewport.scale,
    y: box.y + viewport.y + worldY * viewport.scale,
  };
  await page.mouse.click(first.x, first.y);
  await expect(page.getByText(/Выбрано: 1/).first()).toBeVisible();
  await stage.click({
    position: { x: first.x + 2 * viewport.scale - box.x, y: first.y - box.y },
    modifiers: ['Shift'],
  });
  await expect(page.getByText(/Выбрано: 2/).first()).toBeVisible();
  const frameSamples = page.evaluate(() => new Promise<{ ms: number; phase: string }[]>((resolve) => {
    const samples: { ms: number; phase: string }[] = [];
    let previous = performance.now();
    const tick = (now: number) => {
      samples.push({ ms: now - previous, phase: (window as typeof window & { __hallDragPhase?: string }).__hallDragPhase ?? 'setup' });
      previous = now;
      if (samples.length < 90) requestAnimationFrame(tick);
      else resolve(samples);
    };
    requestAnimationFrame(tick);
  }));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.evaluate(() => { (window as typeof window & { __hallDragPhase?: string }).__hallDragPhase = 'drag'; });
  await page.mouse.move(first.x + 80, first.y, { steps: 25 });
  await page.evaluate(() => { (window as typeof window & { __hallDragPhase?: string }).__hallDragPhase = 'commit'; });
  await page.mouse.up();
  const frames = await frameSamples;
  const dragFrames = frames.filter(({ phase }) => phase === 'drag').map(({ ms }) => ms);
  expect(dragFrames.length).toBeGreaterThanOrEqual(20);
  const browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio }));
  const result = {
    machine: { platform: platform(), cpu: cpus()[0]?.model },
    browser,
    viewport: { width: 1280, height: 800 },
    buildMode: 'Vite production preview',
    fixture: 'Arena grid, 10,000 seats, 250 columns, two selected seats',
    dragP95Ms: percentile(dragFrames, 0.95),
    dragMaxMs: Math.max(...dragFrames),
    fullGestureP95Ms: percentile(frames.map(({ ms }) => ms), 0.95),
    sampleCount: dragFrames.length,
    scale: viewport.scale,
  };
  await test.info().attach('group-drag-10k', {
    body: JSON.stringify(result, null, 2), contentType: 'application/json',
  });
  console.log(JSON.stringify(result));
  if (process.env['HALL_ENFORCE_BUDGET'] === '1')
    expect(result.dragP95Ms).toBeLessThanOrEqual(Number(process.env['HALL_DRAG_BUDGET_MS'] ?? '25'));
});

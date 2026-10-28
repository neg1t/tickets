import { expect, test, type Page } from '@playwright/test';
import { layoutDocumentSchema, layoutSnapshotSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json';

const baseSnapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
const snapshot = layoutSnapshotSchema.parse({
  ...baseSnapshot,
  zones: [...baseSnapshot.zones, {
    id: 'pricing-zone-ga', floorId: baseSnapshot.floors[0]!.id,
    name: 'Dance floor', kind: 'ga', capacity: 500,
  }],
});
const eventId = 'pricing-concert';
const segments = [
  { id: 'segment-standard', name: 'Стандарт', color: '#2b7b68', status: 'active', price: { amountMinor: 125000, currency: 'RUB' } },
  { id: 'segment-vip', name: 'VIP', color: '#784fa3', status: 'active', price: { amountMinor: 250000, currency: 'RUB' } },
  { id: 'segment-economy', name: 'Эконом', color: '#bd8424', status: 'active', price: { amountMinor: 75000, currency: 'RUB' } },
];

async function mockPricingApi(page: Page, options: { firstSaveError?: 'service_unavailable' | 'revision_conflict' | 'invalid_response'; orderCalls?: string[] } = {}) {
  let assignments = { seatSegments: {} as Record<string, string>, gaZoneSegments: {} as Record<string, string> };
  let revision = 1;
  let serverHold: null | {
    apiVersion: 'v1'; id: string; occurrenceId: string; expiresAt: string;
    selection: { kind: 'seat'; seatId: string }[];
    total: { amountMinor: number; currency: string }; availabilityRevision: number;
  } = null;
  const writes: { key: string | undefined; ifMatch: string | undefined; body: unknown }[] = [];
  const occurrence = () => ({
    apiVersion: 'v1', id: eventId, title: 'Pricing Concert', startsAt: '2026-10-28T12:00:00Z',
    layoutVersionId: snapshot.layoutVersionId, layout: { hallName: 'Small Theater', snapshot },
    availability: {
      apiVersion: 'v1', revision: serverHold ? 2 : 1,
      seats: Object.fromEntries(snapshot.seats.map((seat) => [
        seat.id,
        serverHold?.selection.some((item) => item.kind === 'seat' && item.seatId === seat.id)
          ? 'held'
          : 'available',
      ])),
      zones: { 'pricing-zone-ga': { available: 500 } },
    },
    prices: {
      apiVersion: 'v1',
      seats: Object.fromEntries(snapshot.seats.map((seat) => [seat.id, {
        amountMinor: revision > 1 ? 175000 : 125000,
        currency: 'RUB', category: 'Server price',
      }])),
      zones: {},
    },
    ownHold: serverHold,
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
    });
    if (path === '/api/v1/halls') return json({ apiVersion: 'v1', items: [] });
    if (path === '/api/v1/occurrences') return json({ apiVersion: 'v1', items: [occurrence()] });
    if (path === `/api/v1/occurrences/${eventId}`) return json(occurrence());
    if (path === `/api/v1/occurrences/${eventId}/pricing-segments`) return json({
      apiVersion: 'v1', occurrenceId: eventId, revision: 4, items: segments,
    });
    if (path === `/api/v1/occurrences/${eventId}/pricing-assignments` && request.method() === 'GET') return json({
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: eventId,
      layoutVersionId: snapshot.layoutVersionId, revision, catalogRevision: 4, assignments,
    });
    if (path === `/api/v1/occurrences/${eventId}/pricing-assignments` && request.method() === 'PUT') {
      writes.push({ key: request.headers()['idempotency-key'], ifMatch: request.headers()['if-match'], body: request.postDataJSON() });
      if (writes.length === 1 && options.firstSaveError === 'service_unavailable') return json({
        apiVersion: 'v1', code: 'service_unavailable', message: 'Retry after checking the same save attempt',
      }, 503);
      if (writes.length === 1 && options.firstSaveError === 'revision_conflict') return json({
        apiVersion: 'v1', code: 'revision_conflict', message: 'Pricing assignments changed', currentRevision: revision + 1,
      }, 409);
      if (writes.length === 1 && options.firstSaveError === 'invalid_response') return json({
        apiVersion: 'v1', schemaVersion: 1, occurrenceId: eventId,
        layoutVersionId: snapshot.layoutVersionId, revision, catalogRevision: 4,
        assignments: { seatSegments: 'not-a-map', gaZoneSegments: {} },
      });
      const body = request.postDataJSON() as { assignments: typeof assignments };
      assignments = body.assignments;
      revision += 1;
      return json({
        apiVersion: 'v1', schemaVersion: 1, occurrenceId: eventId,
        layoutVersionId: snapshot.layoutVersionId, revision, catalogRevision: 4, assignments,
      });
    }
    if (path === '/api/v1/occurrences/pricing-concert/holds' && request.method() === 'POST') {
      const body = request.postDataJSON() as { selection: { kind: string; seatId?: string }[] };
      serverHold = { apiVersion: 'v1', id: 'pricing-hold', occurrenceId: eventId,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        selection: body.selection as { kind: 'seat'; seatId: string }[],
        total: { amountMinor: 150000, currency: 'RUB' }, availabilityRevision: 1 };
      return json(serverHold);
    }
    if (path === '/api/v1/orders' && request.method() === 'POST') {
      options.orderCalls?.push('create');
      return json({
        apiVersion: 'v1', id: 'pricing-order', occurrenceId: eventId, holdId: 'pricing-hold', status: 'pending',
        selection: serverHold?.selection ?? [], total: serverHold?.total ?? { amountMinor: 150000, currency: 'RUB' },
        createdAt: new Date().toISOString(),
      });
    }
    if (path === '/api/v1/orders/pricing-order/checkout' && request.method() === 'POST') {
      options.orderCalls?.push('checkout');
      const order = {
        apiVersion: 'v1', id: 'pricing-order', occurrenceId: eventId, holdId: 'pricing-hold', status: 'confirmed',
        selection: serverHold?.selection ?? [], total: serverHold?.total ?? { amountMinor: 150000, currency: 'RUB' },
        createdAt: new Date().toISOString(),
      };
      serverHold = null;
      return json(order);
    }
    return json({ apiVersion: 'v1', code: 'not_found', message: path }, 404);
  });
  return writes;
}

async function openPricing(page: Page) {
  await page.goto('/?mode=api&apiBase=http%3A%2F%2Fpricing-api.test');
  await expect(page.getByRole('heading', { name: 'API Studio' })).toBeVisible();
  await page.getByRole('button', { name: 'Настроить цены' }).click();
  await expect(page.getByRole('heading', { name: 'Цены и сегменты' })).toBeVisible();
}

async function assignFirstZone(page: Page) {
  await page.getByRole('list', { name: 'Сектора' }).getByRole('button', { name: /Left sector/ }).click();
  await page.getByRole('button', { name: 'Назначить выбранным' }).click();
}

async function worldPointOnViewer(page: Page, position: { x: number; y: number }) {
  return page.locator('.pricing-editor .hall-viewer-canvas').evaluate((element, world) => {
    const bounds = element.getBoundingClientRect();
    const data = (element as HTMLElement).dataset;
    const scale = Number(data.viewportScale);
    return {
      x: bounds.left + Number(data.viewportX) + world.x * scale,
      y: bounds.top + Number(data.viewportY) + world.y * scale,
    };
  }, position);
}

test('pricing automatically selects seats or zones and Ctrl-click toggles targets', async ({ page }) => {
  await mockPricingApi(page);
  await openPricing(page);

  await expect(page.getByRole('button', { name: 'Сектора', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Места', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Заменить выбор' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить к выбору' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Убрать из выбора' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Перед применением' })).toHaveCount(0);

  const seat = snapshot.seats.find(({ label }) => label === 'L1-1');
  if (!seat) throw new Error('Fixture is missing seat L1-1');
  const seatPoint = await worldPointOnViewer(page, seat.position);
  const zonePoint = await worldPointOnViewer(page, { x: 3, y: 16.5 });
  const status = page.locator('.hall-viewer-status');

  await page.mouse.click(seatPoint.x, seatPoint.y);
  await expect(status).toContainText('Выбрано: 1');
  await expect(status).toContainText('L1-1');

  await page.keyboard.down('Control');
  await page.mouse.click(zonePoint.x, zonePoint.y);
  await page.keyboard.up('Control');
  await expect(status).toContainText('Выбрано: 2');
  await expect(status).toContainText('Left sector');

  await page.keyboard.down('Control');
  await page.mouse.click(zonePoint.x, zonePoint.y);
  await page.keyboard.up('Control');
  await expect(status).toContainText('Выбрано: 1');
  await expect(status).toContainText('L1-1');
  await expect(status).not.toContainText('Left sector');

  await page.mouse.click(zonePoint.x, zonePoint.y);
  await expect(status).toContainText('Выбрано: 1');
  await expect(status).toContainText('Left sector');
  await expect(status).not.toContainText('L1-1');
});

test('pricing box replaces selection and Ctrl-box adds targets', async ({ page }) => {
  await mockPricingApi(page);
  await openPricing(page);

  const status = page.locator('.hall-viewer-status');
  async function boxAroundSeat(position: { x: number; y: number }, ctrl = false) {
    const start = await worldPointOnViewer(page, { x: position.x - 0.8, y: position.y - 0.8 });
    const end = await worldPointOnViewer(page, { x: position.x + 0.8, y: position.y + 0.8 });
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
    if (ctrl) await page.keyboard.up('Control');
  }

  const firstSeat = snapshot.seats.find(({ label }) => label === 'L1-1');
  const secondSeat = snapshot.seats.find(({ label }) => label === 'L1-2');
  const thirdSeat = snapshot.seats.find(({ label }) => label === 'L1-3');
  if (!firstSeat || !secondSeat || !thirdSeat) throw new Error('Fixture is missing the first pricing row');

  await boxAroundSeat(firstSeat.position);
  await expect(status).toContainText('Выбрано: 1');
  await expect(status).toContainText('L1-1');

  await boxAroundSeat(secondSeat.position, true);
  await expect(status).toContainText('Выбрано: 2');
  await expect(status).toContainText('L1-2');

  await boxAroundSeat(thirdSeat.position);
  await expect(status).toContainText('Выбрано: 1');
  await expect(status).toContainText('L1-3');
  await expect(status).not.toContainText('L1-1');
});

test('pricing assignment saves IDs, reloads server prices and previews without checkout', async ({ page }) => {
  const writes = await mockPricingApi(page);
  await openPricing(page);
  await assignFirstZone(page);

  const targetSeat = snapshot.seats.find(({ label }) => label === 'L1-1');
  if (!targetSeat) throw new Error('Fixture is missing seat L1-1');
  const viewer = page.locator('.pricing-editor .hall-viewer-canvas');
  const seatPoint = await viewer.evaluate((element, position) => {
    const bounds = element.getBoundingClientRect();
    const data = (element as HTMLElement).dataset;
    const scale = Number(data.viewportScale);
    return {
      x: bounds.left + Number(data.viewportX) + position.x * scale,
      y: bounds.top + Number(data.viewportY) + position.y * scale,
    };
  }, targetSeat.position);
  await page.mouse.click(seatPoint.x, seatPoint.y);
  await page.getByRole('radio', { name: /VIP/ }).click();
  await expect(page.getByRole('button', { name: 'Назначить выбранным' })).toBeEnabled();
  await page.getByRole('button', { name: 'Назначить выбранным' }).click();

  await page.getByRole('list', { name: 'Сектора' }).getByRole('button', { name: /Left sector/ }).click();
  await page.getByRole('radio', { name: /Эконом/ }).click();
  await page.getByRole('button', { name: 'Назначить выбранным' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();

  await page.getByRole('button', { name: 'Сохранить цены' }).click();
  await expect(page.getByText('Покупательские цены перечитаны с сервера.')).toBeVisible();

  expect(writes).toHaveLength(1);
  expect(writes[0]?.ifMatch).toBe('"1"');
  expect(writes[0]?.key).toBeTruthy();
  expect(writes[0]?.body).toMatchObject({
    apiVersion: 'v1', schemaVersion: 1, occurrenceId: eventId,
    layoutVersionId: snapshot.layoutVersionId, catalogRevision: 4,
  });
  expect(Object.keys((writes[0]?.body as { assignments: { seatSegments: Record<string, string> } }).assignments.seatSegments).length).toBeGreaterThan(0);
  const savedAssignments = (writes[0]?.body as { assignments: { seatSegments: Record<string, string> } }).assignments.seatSegments;
  expect(savedAssignments[targetSeat.id]).toBe('segment-vip');
  expect(Object.entries(savedAssignments).filter(([id]) => id !== targetSeat.id).every(([, segmentId]) => segmentId === 'segment-standard')).toBe(true);
  expect(writes[0]?.body).not.toHaveProperty('prices');

  await page.getByRole('button', { name: 'Предпросмотр покупателя' }).click();
  const preview = page.getByRole('region', { name: 'Места: Small Theater' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Купить' })).toBeDisabled();
  await page.getByRole('button', { name: 'Покупательский экран' }).click();
  await expect(page.getByRole('region', { name: 'Места: Small Theater' })).toContainText('1 750,00');
});

test('pricing GA assignment stores the zone ID separately and leaves its capacity in the layout', async ({ page }) => {
  const writes = await mockPricingApi(page);
  await openPricing(page);
  await page.getByRole('list', { name: 'Сектора' }).getByRole('button', { name: /Dance floor/ }).click();
  await page.getByRole('button', { name: 'Назначить выбранным' }).click();
  await page.getByRole('button', { name: 'Сохранить цены' }).click();
  await expect(page.getByText('Покупательские цены перечитаны с сервера.')).toBeVisible();

  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toMatchObject({
    assignments: { seatSegments: {}, gaZoneSegments: { 'pricing-zone-ga': 'segment-standard' } },
  });
  expect(snapshot.zones.find(({ id }) => id === 'pricing-zone-ga')?.capacity).toBe(500);
});

test('pricing save retries an unknown outcome with the same body and idempotency key', async ({ page }) => {
  const writes = await mockPricingApi(page, { firstSaveError: 'service_unavailable' });
  await openPricing(page);
  await assignFirstZone(page);
  await page.getByRole('button', { name: 'Сохранить цены' }).click();
  await expect(page.getByRole('button', { name: 'Повторить сохранение с тем же ключом' })).toBeVisible();
  await page.reload();
  await openPricing(page);
  await expect(page.getByRole('button', { name: 'Повторить сохранение с тем же ключом' })).toBeVisible();
  await page.getByRole('button', { name: 'Повторить сохранение с тем же ключом' }).click();
  await expect(page.getByText('Покупательские цены перечитаны с сервера.')).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]?.key).toBe(writes[0]?.key);
  expect(writes[1]?.body).toEqual(writes[0]?.body);
});

test('pricing revision conflict preserves the dirty assignment draft', async ({ page }) => {
  const writes = await mockPricingApi(page, { firstSaveError: 'revision_conflict' });
  await openPricing(page);
  await assignFirstZone(page);
  await page.getByRole('button', { name: 'Сохранить цены' }).click();
  await expect(page.getByRole('alert')).toContainText('Данные изменились на сервере');
  await expect(page.getByRole('status').filter({ hasText: 'Есть несохранённые изменения' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить цены' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сверить состояние с сервером' })).toBeVisible();
  expect(writes).toHaveLength(1);
});

test('pricing rejects a malformed successful save response without showing success', async ({ page }) => {
  const writes = await mockPricingApi(page, { firstSaveError: 'invalid_response' });
  await openPricing(page);
  await assignFirstZone(page);
  await page.getByRole('button', { name: 'Сохранить цены' }).click();

  await expect(page.locator('.api-studio-pricing-retry')).toContainText('Результат PUT неизвестен');
  await expect(page.getByRole('button', { name: 'Повторить сохранение с тем же ключом' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Покупательские цены перечитаны с сервера.' })).toHaveCount(0);
  expect(writes).toHaveLength(1);
});

test('pricing cancels box selection when a second touch arrives', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const writes = await mockPricingApi(page);
  await openPricing(page);
  const targetSeat = snapshot.seats.find(({ label }) => label === 'L1-1');
  if (!targetSeat) throw new Error('Fixture is missing seat L1-1');
  const viewer = page.locator('.pricing-editor .hall-viewer-canvas');
  const seatPoint = await viewer.evaluate((element, position) => {
    const bounds = element.getBoundingClientRect();
    const data = (element as HTMLElement).dataset;
    const scale = Number(data.viewportScale);
    return {
      x: bounds.left + Number(data.viewportX) + position.x * scale,
      y: bounds.top + Number(data.viewportY) + position.y * scale,
    };
  }, targetSeat.position);
  const start = { x: seatPoint.x - 24, y: seatPoint.y - 24 };
  const end = { x: seatPoint.x + 24, y: seatPoint.y + 24 };
  const touch = await context.newCDPSession(page);

  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ ...start, id: 1 }],
  });
  await expect(viewer).toHaveAttribute('data-pointer-mode', 'box');
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ ...end, id: 1 }],
  });
  await expect(viewer).toHaveAttribute('data-pointer-mode', 'box');
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ ...end, id: 1 }, { x: end.x + 12, y: end.y + 12, id: 2 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(viewer).toHaveAttribute('data-pointer-mode', 'idle');
  await expect(page.getByRole('button', { name: 'Назначить выбранным' })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await context.close();
});

test('API buyer requires explicit confirmation when the server hold total changed', async ({ page }) => {
  const orderCalls: string[] = [];
  await mockPricingApi(page, { orderCalls });
  await page.goto('/?mode=api&apiBase=http%3A%2F%2Fpricing-api.test');
  await page.getByRole('button', { name: 'Pricing Concert' }).click();
  const view = page.getByRole('region', { name: 'Места: Small Theater' });
  await view.getByRole('button', { name: /Место L1-1/ }).click();
  await view.getByRole('button', { name: 'Купить' }).click();
  await expect(page.locator('.api-studio-price-change')).toContainText('Сумма сервера отличается');
  await expect(page.getByText('Выбранные места больше недоступны')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Подтвердить новую сумму и покупку' })).toBeVisible();
  expect(orderCalls).toEqual([]);
  await page.getByRole('button', { name: 'Подтвердить новую сумму и покупку' }).click();
  await expect(page.getByText(/Покупка подтверждена: заказ pricing-order,/)).toBeVisible();
  expect(orderCalls).toEqual(['create', 'checkout']);
});

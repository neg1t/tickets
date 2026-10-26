import { expect, test } from '@playwright/test';
import { createEmptyDraft } from '@hall-platform/domain';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json';

test.skip(process.env['HALL_API_MODE_TEST'] !== '1', 'Run with VITE_HALL_MODE=api and an API base URL');

test('API mode loads a hall and saves with the server revision', async ({ page }) => {
  const draft = createEmptyDraft('API hall');
  let revision = 1;
  const writes: { url: string; ifMatch: string | null; key: string | null }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/halls' && request.method() === 'GET')
      return json({ apiVersion: 'v1', items: [{
        apiVersion: 'v1', id: draft.snapshot.id, name: draft.hallName,
        updatedAt: '2026-10-26T00:00:00Z', revision,
        publishedVersionNumber: 0, seats: 0, zones: 0,
      }] });
    if (path === '/api/v1/occurrences') return json({ apiVersion: 'v1', items: [] });
    if (path === `/api/v1/halls/${draft.snapshot.id}`) return json({
      apiVersion: 'v1', id: draft.snapshot.id, revision,
      updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 0, draft,
    });
    if (path === `/api/v1/layouts/${draft.snapshot.id}/versions`)
      return json({ apiVersion: 'v1', items: [] });
    if (path === `/api/v1/layouts/${draft.snapshot.id}/draft` && request.method() === 'PUT') {
      writes.push({ url: path, ifMatch: request.headers()['if-match'] ?? null,
        key: request.headers()['idempotency-key'] ?? null });
      if (writes.length === 1) return json({ apiVersion: 'v1', code: 'service_unavailable', message: 'Retry later' }, 503);
      revision += 1;
      return json({ apiVersion: 'v1', id: draft.snapshot.id, revision,
        updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 0, draft });
    }
    return json({ apiVersion: 'v1', code: 'not_found', message: path }, 404);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'API Studio' })).toBeVisible();
  await page.screenshot({ path: 'apps/studio/test-output/api-catalog.png', fullPage: true });
  await page.getByRole('button', { name: 'API hall' }).click();
  await expect(page.getByRole('region', { name: 'Редактор зала API hall' })).toBeVisible();
  await page.screenshot({ path: 'apps/studio/test-output/api-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Сохранить на сервере' }).click();
  await expect(page.getByRole('alert')).toContainText('Retry later');
  await page.getByRole('button', { name: 'Сохранить на сервере' }).click();
  await expect(page.getByRole('status')).toContainText('Сохранено');
  expect(writes).toHaveLength(2);
  expect(writes[0]?.ifMatch).toBe('"1"');
  expect(writes[0]?.key).toBeTruthy();
  expect(writes[1]?.key).toBe(writes[0]?.key);
});

test('API buyer uses server hold, total and confirmed order', async ({ page }) => {
  const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
  const seat = snapshot.seats[0];
  if (!seat) throw new Error('Fixture has no seats');
  let seatStatus: 'available' | 'held' | 'sold' = 'available';
  let hold: null | {
    apiVersion: 'v1'; id: string; occurrenceId: string; expiresAt: string;
    selection: { kind: 'seat'; seatId: string }[];
    total: { amountMinor: number; currency: string }; availabilityRevision: number;
  } = null;
  const calls: { path: string; key: string | undefined; body: unknown }[] = [];
  const occurrence = () => ({
    apiVersion: 'v1', id: 'concert-1', title: 'API Concert', startsAt: '2026-10-26T12:00:00Z',
    layoutVersionId: 'small-theater-v1', layout: { hallName: 'Small Theater', snapshot },
    availability: { apiVersion: 'v1', revision: seatStatus === 'available' ? 1 : seatStatus === 'held' ? 2 : 3,
      seats: { [seat.id]: seatStatus }, zones: {} },
    prices: { apiVersion: 'v1', seats: { [seat.id]: { amountMinor: 125000, currency: 'RUB' } }, zones: {} },
    ownHold: hold,
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/v1/halls') return json({ apiVersion: 'v1', items: [] });
    if (path === '/api/v1/occurrences') return json({ apiVersion: 'v1', items: [occurrence()] });
    if (path === '/api/v1/occurrences/concert-1' && request.method() === 'GET') return json(occurrence());
    if (path === '/api/v1/occurrences/concert-1/holds' && request.method() === 'POST') {
      calls.push({ path, key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      seatStatus = 'held';
      hold = { apiVersion: 'v1', id: 'hold-1', occurrenceId: 'concert-1', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        selection: [{ kind: 'seat', seatId: seat.id }], total: { amountMinor: 125000, currency: 'RUB' }, availabilityRevision: 2 };
      return json(hold);
    }
    if (path === '/api/v1/orders' && request.method() === 'POST') {
      calls.push({ path, key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      return json({ apiVersion: 'v1', id: 'order-1', occurrenceId: 'concert-1', holdId: 'hold-1', status: 'pending',
        selection: [{ kind: 'seat', seatId: seat.id }], total: { amountMinor: 125000, currency: 'RUB' }, createdAt: '2026-10-26T12:01:00Z' });
    }
    if (path === '/api/v1/orders/order-1/checkout' && request.method() === 'POST') {
      calls.push({ path, key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      seatStatus = 'sold'; hold = null;
      return json({ apiVersion: 'v1', id: 'order-1', occurrenceId: 'concert-1', holdId: 'hold-1', status: 'confirmed',
        selection: [{ kind: 'seat', seatId: seat.id }], total: { amountMinor: 125000, currency: 'RUB' }, createdAt: '2026-10-26T12:01:00Z' });
    }
    return json({ apiVersion: 'v1', code: 'not_found', message: path }, 404);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'API Concert' }).click();
  const view = page.getByRole('region', { name: 'Места: Small Theater' });
  await view.getByRole('button', { name: /Место L1-1/ }).click();
  await view.getByRole('button', { name: 'Купить' }).click();
  await expect(page.getByText(/Удержание до/)).toContainText('1 250,00');
  await page.getByRole('button', { name: 'Подтвердить покупку' }).click();
  await expect(page.getByText(/Покупка подтверждена: заказ order-1/).last()).toBeVisible();
  expect(calls.map((call) => call.path)).toEqual([
    '/api/v1/occurrences/concert-1/holds', '/api/v1/orders', '/api/v1/orders/order-1/checkout',
  ]);
  expect(calls.every((call) => Boolean(call.key))).toBe(true);
  expect(calls[0]?.body).toMatchObject({ availabilityRevision: 1,
    selection: [{ kind: 'seat', seatId: seat.id }] });
});

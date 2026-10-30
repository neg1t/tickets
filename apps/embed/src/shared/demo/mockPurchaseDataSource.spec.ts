// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { BuyerApiError } from '@hall-platform/api-axios';
import type { BuyerHoldRequest } from '@hall-platform/api-contracts';
import type { PurchaseDataSource } from '@hall-platform/ticket-purchase';
import { PurchaseConfigurationError } from '@hall-platform/ticket-purchase';
import { createHttpPurchaseDataSource } from '@hall-platform/ticket-purchase/http';
import {
  createMockPurchaseDataSource,
  resolveEmbedPurchaseDataSource,
  type MockPurchaseDataSourceOptions,
} from './mockPurchaseDataSource.js';

const instant = new Date('2026-10-30T12:00:00.000Z');

function makeMock(options: Partial<MockPurchaseDataSourceOptions> = {}) {
  let nextId = 0;
  return createMockPurchaseDataSource({
    now: () => instant,
    otpCode: '246810',
    idFactory: (kind) => `${kind}-${++nextId}`,
    ...options,
  });
}

async function runBuyerPurchaseContract(source: PurchaseDataSource) {
  const occurrenceId = 'demo-occurrence';
  const session = await source.createSession({ occurrenceId }, 'session-1');
  const resumeStart = await source.resumeSession(session.purchaseSessionId);
  const context = await source.getContext(session.purchaseSessionId, occurrenceId);
  const occurrences = await source.listOccurrences('demo-event', null);
  const seatMap = await source.getSeatMap(occurrenceId);
  const availability = await source.getAvailability(occurrenceId);
  const changes = await source.getChanges(occurrenceId, availability.revision);
  const prices = await source.getPrices(occurrenceId);
  const hold = await source.createHold(session.purchaseSessionId, occurrenceId, {
    apiVersion: 'v2', layoutVersionId: 'demo-layout-v1', availabilityRevision: 1,
    pricingRevision: 1, selection: [{ kind: 'generalAdmission', zoneId: 'demo-ga', quantity: 2 }],
  }, 'hold-1');
  const saved = await source.saveContact(session.purchaseSessionId, {
    firstName: 'Ada', lastName: 'Lovelace', phone: '+12025550125', email: 'ada@example.test',
  }, 0, 'contact-1');
  const challenge = await source.requestEmail(session.purchaseSessionId, 'ada@example.test', 'otp-start-1');
  await expect(source.verifyEmail(session.purchaseSessionId, challenge.challengeId, '000000', 'otp-wrong'))
    .rejects.toMatchObject({ code: 'invalid_code' });
  const verified = await source.verifyEmail(session.purchaseSessionId, challenge.challengeId, '246810', 'otp-verify-1');
  const order = await source.createOrder(session.purchaseSessionId, hold.id, saved.contactRevision, 'order-1');
  await expect(source.createQuote(session.purchaseSessionId, order.id, order.revision, 'INVALID', 'quote-invalid'))
    .rejects.toMatchObject({ code: 'invalid_promo' });
  const quote = await source.createQuote(session.purchaseSessionId, order.id, order.revision, 'SAVE10', 'quote-1');
  const quotedOrder = await source.getOrder(session.purchaseSessionId, order.id);
  const checkout = await source.checkout(session.purchaseSessionId, order.id, {
    quoteId: quote.quoteId, quoteRevision: quote.revision, orderRevision: quotedOrder.revision,
  }, 'checkout-1');
  const currentOrder = await source.getOrder(session.purchaseSessionId, order.id);
  const otherWidget = await source.createSession({ occurrenceId }, 'other-widget-session');
  await expect(source.getOrder(otherWidget.purchaseSessionId, order.id)).rejects.toMatchObject({ code: 'not_found' });
  const tickets = await source.getTickets(session.purchaseSessionId, order.id);
  const resumed = await source.resumeSession(session.purchaseSessionId);

  return { session, resumeStart, context, occurrences, seatMap, availability, changes, prices, hold, saved, verified, quote, checkout, currentOrder, tickets, resumed };
}

async function runOwnershipAndIdempotencyContract(source: PurchaseDataSource) {
  const first = await source.createSession({ occurrenceId: 'demo-occurrence' }, 'session-a');
  const second = await source.createSession({ occurrenceId: 'demo-occurrence' }, 'session-b');
  const request = {
    apiVersion: 'v2' as const, layoutVersionId: 'demo-layout-v1', availabilityRevision: 1,
    pricingRevision: 1, selection: [{ kind: 'generalAdmission' as const, zoneId: 'demo-ga', quantity: 1 }],
  };
  const hold = await source.createHold(first.purchaseSessionId, 'demo-occurrence', request, 'same-hold-key');
  const replay = await source.createHold(first.purchaseSessionId, 'demo-occurrence', request, 'same-hold-key');
  await expect(source.createHold(first.purchaseSessionId, 'demo-occurrence', {
    ...request, selection: [{ kind: 'generalAdmission', zoneId: 'demo-ga', quantity: 2 }],
  }, 'same-hold-key')).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await expect(source.getHold(second.purchaseSessionId, hold.id)).rejects.toMatchObject({ code: 'not_found' });
  const cancelled = await source.cancelHold(first.purchaseSessionId, hold.id, hold.revision, 'cancel-key');
  const cancelReplay = await source.cancelHold(first.purchaseSessionId, hold.id, hold.revision, 'cancel-key');
  return { hold, replay, cancelled, cancelReplay, sessionIds: [first.purchaseSessionId, second.purchaseSessionId] };
}

type RecordedRequest = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: unknown };

async function createMockBackedHttpServer(source: PurchaseDataSource) {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer(async (request, response) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body: unknown = raw ? JSON.parse(raw) as unknown : null;
    const record: RecordedRequest = {
      method: request.method ?? '', url: request.url ?? '',
      headers: {
        authorization: request.headers.authorization,
        'x-purchase-session-id': request.headers['x-purchase-session-id'],
        'idempotency-key': request.headers['idempotency-key'],
        'if-match': request.headers['if-match'],
      }, body,
    };
    requests.push(record);
    const route = new URL(record.url, 'http://localhost');
    const sessionId = String(record.headers['x-purchase-session-id'] ?? '');
    const key = String(record.headers['idempotency-key'] ?? '');
    const payload = body as Record<string, unknown> | null;
    let result: unknown;
    let status = 200;
    try {
      if (record.method === 'POST' && route.pathname === '/api/v2/buyer/sessions') {
        status = 201;
        result = await source.createSession(payload as { occurrenceId: string }, key);
      } else if (record.method === 'GET' && /\/events\/[^/]+\/occurrences$/.test(route.pathname)) {
        const eventId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.listOccurrences(eventId, route.searchParams.get('cursor'));
      } else if (record.method === 'GET' && /\/occurrences\/[^/]+\/context$/.test(route.pathname)) {
        const occurrenceId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.getContext(sessionId, occurrenceId);
      } else if (record.method === 'GET' && /\/occurrences\/[^/]+\/seat-map$/.test(route.pathname)) {
        const occurrenceId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.getSeatMap(occurrenceId);
      } else if (record.method === 'GET' && /\/occurrences\/[^/]+\/availability-changes$/.test(route.pathname)) {
        const occurrenceId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.getChanges(occurrenceId, Number(route.searchParams.get('sinceRevision')));
      } else if (record.method === 'GET' && /\/occurrences\/[^/]+\/availability$/.test(route.pathname)) {
        const occurrenceId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.getAvailability(occurrenceId);
      } else if (record.method === 'GET' && route.pathname.endsWith('/prices')) {
        result = await source.getPrices(decodeURIComponent(route.pathname.split('/').at(-2) ?? ''));
      } else if (record.method === 'POST' && route.pathname.endsWith('/holds')) {
        status = 201;
        result = await source.createHold(sessionId, decodeURIComponent(route.pathname.split('/').at(-2) ?? ''), payload as BuyerHoldRequest, key);
      } else if (record.method === 'GET' && /\/holds\/[^/]+$/.test(route.pathname)) {
        const holdId = decodeURIComponent(route.pathname.split('/').at(-1) ?? '');
        result = await source.getHold(sessionId, holdId);
      } else if (record.method === 'DELETE' && /\/holds\/[^/]+$/.test(route.pathname)) {
        const holdId = decodeURIComponent(route.pathname.split('/').at(-1) ?? '');
        const expectedRevision = Number(String(record.headers['if-match'] ?? '').replaceAll('"', ''));
        result = await source.cancelHold(sessionId, holdId, expectedRevision, key);
      } else if (record.method === 'PUT' && route.pathname.endsWith('/contact')) {
        result = await source.saveContact(sessionId, payload?.contact as never, Number(payload?.contactRevision), key);
      } else if (record.method === 'POST' && route.pathname.endsWith('/email-challenges')) {
        result = await source.requestEmail(sessionId, String(payload?.email), key);
      } else if (record.method === 'POST' && /\/email-challenges\/[^/]+\/verify$/.test(route.pathname)) {
        const challengeId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.verifyEmail(sessionId, challengeId, String(payload?.code), key);
      } else if (record.method === 'POST' && route.pathname === '/api/v2/buyer/orders') {
        status = 201;
        result = await source.createOrder(sessionId, String(payload?.holdId), Number(payload?.contactRevision), key);
      } else if (record.method === 'POST' && /\/orders\/[^/]+\/quotes$/.test(route.pathname)) {
        const orderId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = await source.createQuote(sessionId, orderId, Number(payload?.orderRevision), payload?.promoCode as string | null | undefined, key);
      } else if (record.method === 'POST' && /\/orders\/[^/]+\/checkout$/.test(route.pathname)) {
        const orderId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        const value = payload as { quoteId: string; quoteRevision: number; orderRevision: number };
        result = await source.checkout(sessionId, orderId, value, key);
      } else if (record.method === 'GET' && route.pathname.endsWith('/resume')) {
        result = await source.resumeSession(sessionId);
      } else if (record.method === 'GET' && /\/orders\/[^/]+\/tickets$/.test(route.pathname)) {
        const orderId = decodeURIComponent(route.pathname.split('/').at(-2) ?? '');
        result = { apiVersion: 'v2', items: await source.getTickets(sessionId, orderId) };
      } else if (record.method === 'GET' && /\/orders\/[^/]+$/.test(route.pathname)) {
        const orderId = decodeURIComponent(route.pathname.split('/').at(-1) ?? '');
        result = await source.getOrder(sessionId, orderId);
      } else {
        status = 404;
        result = { apiVersion: 'v2', code: 'not_found', message: `Unknown route ${route.pathname}` };
      }
      response.writeHead(status, { 'content-type': 'application/json' });
    } catch (error) {
      const apiError = error instanceof BuyerApiError ? error : new BuyerApiError('service_unavailable', 'Mock server error');
      status = apiError.code === 'not_found' ? 404 : apiError.code === 'price_changed' ? 409 : 422;
      result = { apiVersion: 'v2', code: apiError.code, message: apiError.message,
        ...(apiError.currentRevision === undefined ? {} : { currentRevision: apiError.currentRevision }) };
      response.writeHead(status, { 'content-type': 'application/json' });
    }
    response.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server port');
  return { server, requests, baseURL: `http://127.0.0.1:${address.port}` };
}

describe('purchase data source contract', () => {
  it('runs the same hold, contact, OTP, promo, and pending-payment scenario against mock and HTTP', async () => {
    const mockResult = await runBuyerPurchaseContract(makeMock());
    const serverSource = makeMock();
    const httpServer = await createMockBackedHttpServer(serverSource);
    const httpSource = createHttpPurchaseDataSource({
      baseURL: httpServer.baseURL,
      getSessionCredential: (sessionId) => `credential-${sessionId}`,
    });
    try {
      const httpResult = await runBuyerPurchaseContract(httpSource);
      for (const result of [mockResult, httpResult]) {
        expect(result.resumeStart.ownHold).toBeNull();
        expect(result.context.capabilities.paymentMode).toBe('none');
        expect(result.occurrences.items).toHaveLength(1);
        expect(result.seatMap.snapshot.backgrounds).toEqual([]);
        expect(result.availability.zones['demo-ga']?.available).toBe(200);
        expect(result.changes.resyncRequired).toBe(false);
        expect(result.prices.currency).toBe('RUB');
        expect(result.hold.totalMinor).toBe(9000);
        expect(result.verified.emailVerification?.status).toBe('verified');
        expect(result.quote.promo.status).toBe('applied');
        expect(result.checkout.order.status).toBe('payment_pending');
        expect(result.currentOrder.paymentStatus).toBe('pending');
        expect(result.tickets.every((ticket) => ticket.deliveryStatus === 'pending')).toBe(true);
        expect(result.resumed.activeOrder?.id).toBe(result.currentOrder.id);
      }
      expect(httpServer.requests.some(({ headers }) => headers['x-purchase-session-id'])).toBe(true);
      const scopedRequests = httpServer.requests.filter(({ url }) =>
        /\/sessions\/current\/(resume|contact|email-challenges)|\/occurrences\/[^/]+\/context|\/holds\/|\/email-challenges\/|\/orders\//.test(url));
      expect(scopedRequests.length).toBeGreaterThan(0);
      expect(scopedRequests.every(({ headers }) =>
        Boolean(headers['x-purchase-session-id']) && Boolean(headers.authorization))).toBe(true);
      expect(httpServer.requests.filter(({ method }) => method !== 'GET')
        .every(({ headers }) => Boolean(headers['idempotency-key']))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => httpServer.server.close(() => resolve()));
      httpSource.dispose();
    }
  });

  it('rejects stale pricing and expires holds using an injected clock', async () => {
    let now = instant.getTime();
    const source = makeMock({ now: () => new Date(now), holdDurationMs: 1_000, stalePriceBeforeFirstHold: true });
    const session = await source.createSession({ occurrenceId: 'demo-occurrence' }, 'session-1');
    await expect(source.createHold(session.purchaseSessionId, 'demo-occurrence', {
      apiVersion: 'v2', layoutVersionId: 'demo-layout-v1', availabilityRevision: 1,
      pricingRevision: 1, selection: [{ kind: 'generalAdmission', zoneId: 'demo-ga', quantity: 1 }],
    }, 'hold-1')).rejects.toMatchObject({ code: 'price_changed' });
    const updatedPrices = await source.getPrices('demo-occurrence');
    expect(updatedPrices.pricingRevision).toBe(2);
    const hold = await source.createHold(session.purchaseSessionId, 'demo-occurrence', {
      apiVersion: 'v2', layoutVersionId: 'demo-layout-v1', availabilityRevision: 1,
      pricingRevision: updatedPrices.pricingRevision, selection: [{ kind: 'generalAdmission', zoneId: 'demo-ga', quantity: 1 }],
    }, 'hold-2');
    now += 1_001;
    expect((await source.getHold(session.purchaseSessionId, hold.id)).status).toBe('expired');
  });

  it('enforces per-widget ownership and idempotent replay with the mock and HTTP server', async () => {
    const mockResult = await runOwnershipAndIdempotencyContract(makeMock());
    const serverSource = makeMock();
    const httpServer = await createMockBackedHttpServer(serverSource);
    const httpSource = createHttpPurchaseDataSource({ baseURL: httpServer.baseURL,
      getSessionCredential: (sessionId) => `credential-${sessionId}` });
    try {
      const httpResult = await runOwnershipAndIdempotencyContract(httpSource);
      for (const result of [mockResult, httpResult]) {
        expect(result.hold.id).toBe(result.replay.id);
        expect(result.cancelled.status).toBe('cancelled');
        expect(result.cancelReplay.revision).toBe(result.cancelled.revision);
        expect(result.sessionIds[0]).not.toBe(result.sessionIds[1]);
      }
    } finally {
      await new Promise<void>((resolve) => httpServer.server.close(() => resolve()));
      httpSource.dispose();
    }
  });

  it('requires an explicit demo mode and never silently selects the mock in production', () => {
    expect(() => resolveEmbedPurchaseDataSource({ mode: 'production' })).toThrow(PurchaseConfigurationError);
    expect(resolveEmbedPurchaseDataSource({ mode: 'demo' })).toBeDefined();
  });

  it('injects latency/failures and respects an aborted signal on reads', async () => {
    let waitedFor: string | undefined;
    const source = makeMock({
      wait: async (operation) => { waitedFor = operation; },
      failures: [{ operation: 'getPrices', code: 'service_unavailable', message: 'Try again' }],
    });
    const controller = new AbortController();
    controller.abort();

    await expect(source.getPrices('demo-occurrence', controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(waitedFor).toBe('getPrices');
    await expect(source.getPrices('demo-occurrence')).rejects.toMatchObject({ code: 'service_unavailable' });
    expect((await source.getPrices('demo-occurrence')).pricingRevision).toBe(1);
  });
});

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBuyerApiClient, BuyerApiError } from './index.js';

type RequestRecord = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

let server: Server;
let baseURL: string;
let requests: RequestRecord[];
let respond: (request: RequestRecord) => { status: number; body: unknown };

beforeEach(async () => {
  requests = [];
  respond = () => ({ status: 404, body: {
    apiVersion: 'v2', code: 'not_found', message: 'Missing',
  } });
  server = createServer(async (request, response) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const item: RequestRecord = {
      method: request.method ?? '',
      url: request.url ?? '',
      headers: {
        authorization: request.headers.authorization,
        'x-purchase-session-id': request.headers['x-purchase-session-id'],
        'idempotency-key': request.headers['idempotency-key'],
        'if-match': request.headers['if-match'],
      },
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(item);
    const result = respond(item);
    response.writeHead(result.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  baseURL = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('v2 buyer API client', () => {
  it('creates a guest session with a required idempotency key and validates the response', async () => {
    respond = () => ({ status: 201, body: {
      apiVersion: 'v2',
      purchaseSessionId: 'widget-session-a',
      sessionCredential: 'opaque-session-secret',
      expiresAt: '2026-10-30T12:00:00Z',
    } });
    const client = createBuyerApiClient({ baseURL });

    const result = await client.createSession({ occurrenceId: 'occurrence-a' }, 'session-create-1');

    expect(result.sessionCredential).toBe('opaque-session-secret');
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v2/buyer/sessions',
      headers: { 'idempotency-key': 'session-create-1' },
      body: { apiVersion: 'v2', occurrenceId: 'occurrence-a' },
    });
    client.dispose();
  });

  it('sends buyer auth and the selected widget session with a versioned hold request', async () => {
    respond = () => ({ status: 201, body: {
      apiVersion: 'v2', id: 'hold-a', ownerSessionId: 'widget-session-a',
      occurrenceId: 'occurrence/a', layoutVersionId: 'layout-v3', revision: 1,
      expiresAt: '2026-10-30T12:15:00Z', serverTime: '2026-10-30T12:00:00Z',
      selection: [{ kind: 'seat', seatId: 'seat-a' }],
      lineItems: [{ label: 'A-1', quantity: 1, unitPriceMinor: 12500, totalMinor: 12500 }],
      totalMinor: 12500, currency: 'RUB', availabilityRevision: 8, status: 'active',
    } });
    const client = createBuyerApiClient({
      baseURL,
      getSessionCredential: (sessionId) => sessionId === 'widget-session-a' ? 'buyer-token' : undefined,
    });

    const result = await client.createHold('widget-session-a', 'occurrence/a', {
      apiVersion: 'v2', layoutVersionId: 'layout-v3', availabilityRevision: 8,
      pricingRevision: 14, selection: [{ kind: 'seat', seatId: 'seat-a' }],
    }, 'hold-request-1');

    expect(result.totalMinor).toBe(12500);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v2/buyer/occurrences/occurrence%2Fa/holds',
      headers: {
        authorization: 'Bearer buyer-token',
        'x-purchase-session-id': 'widget-session-a',
        'idempotency-key': 'hold-request-1',
      },
      body: {
        apiVersion: 'v2', layoutVersionId: 'layout-v3', availabilityRevision: 8,
        pricingRevision: 14,
      },
    });
    client.dispose();
  });

  it('rejects malformed server DTOs instead of returning unvalidated data', async () => {
    respond = () => ({ status: 200, body: {
      apiVersion: 'v2', occurrenceId: 'occurrence-a', layoutVersionId: 'layout-a',
      pricingRevision: 2, currency: 'RUB', seats: { 'seat-a': { amountMinor: -1 } }, zones: {},
    } });
    const client = createBuyerApiClient({ baseURL });

    await expect(client.getPrices('occurrence-a', new AbortController().signal))
      .rejects.toBeInstanceOf(BuyerApiError);
    await expect(client.getPrices('occurrence-a')).rejects.toMatchObject({ code: 'invalid_response' });
    client.dispose();
  });

  it('requires valid idempotency keys before sending mutations', async () => {
    const client = createBuyerApiClient({ baseURL });

    await expect(client.createSession({ occurrenceId: 'occurrence-a' }, ''))
      .rejects.toMatchObject({ code: 'invalid_request' });
    expect(requests).toHaveLength(0);
    client.dispose();
  });

  it('forwards AbortSignal to a buyer read and rejects an already aborted request', async () => {
    const client = createBuyerApiClient({ baseURL });
    const controller = new AbortController();
    controller.abort();

    await expect(client.getPrices('occurrence-a', controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(requests).toHaveLength(0);
    client.dispose();
  });

  it('sends an If-Match hold revision and a unique idempotency key when cancelling a hold', async () => {
    respond = () => ({ status: 204, body: null });
    const client = createBuyerApiClient({ baseURL, getSessionCredential: () => 'buyer-token' });

    const result = await client.cancelHold('session-a', 'hold-a', 1, 'cancel-hold-1');

    expect(result).toBeUndefined();
    expect(requests[0]).toMatchObject({
      method: 'DELETE', url: '/api/v2/buyer/holds/hold-a',
      headers: { authorization: 'Bearer buyer-token', 'x-purchase-session-id': 'session-a',
        'if-match': '"1"', 'idempotency-key': 'cancel-hold-1' },
    });
    client.dispose();
  });

  it('sends null explicitly when clearing a promotion from a quote', async () => {
    respond = () => ({ status: 200, body: {
      apiVersion: 'v2', quoteId: 'quote-a', orderId: 'order/a', revision: 2,
      expiresAt: '2026-10-30T12:05:00Z', currency: 'RUB',
      lines: [{ label: 'A-1', quantity: 1, unitPriceMinor: 100, totalMinor: 100 }],
      ticketsSubtotalMinor: 100, discountMinor: 0, serviceFeeMinor: 0,
      commissionMinor: 0, totalMinor: 100, promo: { status: 'none' },
    } });
    const client = createBuyerApiClient({ baseURL, getSessionCredential: () => 'buyer-token' });

    const result = await client.createQuote('session-a', 'order/a', 1, null, 'quote-clear-promo-1');

    expect(result.promo.status).toBe('none');
    expect(requests[0]).toMatchObject({
      method: 'POST', url: '/api/v2/buyer/orders/order%2Fa/quotes',
      headers: { 'x-purchase-session-id': 'session-a', 'idempotency-key': 'quote-clear-promo-1' },
      body: { apiVersion: 'v2', orderRevision: 1, promoCode: null },
    });
    client.dispose();
  });
});

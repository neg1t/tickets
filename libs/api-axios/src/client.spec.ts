import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDraft } from '@hall-platform/domain';
import { createHallApiClient, HallApiError } from './client.js';

type RequestRecord = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: unknown };
let server: Server;
let baseURL: string;
let requests: RequestRecord[];
let respond: (request: RequestRecord) => { status: number; body: unknown };

beforeEach(async () => {
  requests = [];
  respond = () => ({ status: 404, body: { apiVersion: 'v1', code: 'not_found', message: 'Missing' } });
  server = createServer(async (request, response) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const item: RequestRecord = {
      method: request.method ?? '', url: request.url ?? '',
      headers: {
        authorization: request.headers.authorization,
        'if-match': request.headers['if-match'],
        'idempotency-key': request.headers['idempotency-key'],
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

describe('Axios hall API client', () => {
  it('sends bearer auth and validates a hall response', async () => {
    const draft = createEmptyDraft('API hall');
    respond = () => ({ status: 200, body: {
      apiVersion: 'v1', id: draft.snapshot.id, revision: 2,
      updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 0, draft,
    } });
    const client = createHallApiClient({ baseURL, getToken: () => 'secret' });
    expect((await client.getHall(draft.snapshot.id)).draft).toEqual(draft);
    expect(requests[0]).toMatchObject({
      method: 'GET', url: `/api/v1/halls/${draft.snapshot.id}`,
      headers: { authorization: 'Bearer secret' },
    });
    client.dispose();
  });

  it('rejects malformed JSON returned with success status', async () => {
    respond = () => ({ status: 200, body: { apiVersion: 'v1', id: 'hall-a' } });
    const client = createHallApiClient({ baseURL });
    await expect(client.getHall('hall-a')).rejects.toMatchObject({ code: 'invalid_response' });
    client.dispose();
  });

  it('sends revision and idempotency key for a save and surfaces conflicts', async () => {
    const draft = createEmptyDraft('API hall');
    respond = () => ({ status: 409, body: {
      apiVersion: 'v1', code: 'revision_conflict', message: 'Changed', currentRevision: 3,
    } });
    const client = createHallApiClient({ baseURL });
    await expect(client.saveDraft(draft, 2, 'save-123')).rejects.toMatchObject({
      code: 'revision_conflict', currentRevision: 3,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'PUT', url: `/api/v1/layouts/${draft.snapshot.id}/draft`,
      headers: { 'if-match': '"2"', 'idempotency-key': 'save-123' },
      body: { apiVersion: 'v1', draft },
    });
    client.dispose();
  });

  it('does not send a hold with duplicate seats or an invalid idempotency key', async () => {
    const client = createHallApiClient({ baseURL });
    await expect(client.createHold('occurrence-a', [
      { kind: 'seat', seatId: 'seat-a' }, { kind: 'seat', seatId: 'seat-a' },
    ], '')).rejects.toBeInstanceOf(HallApiError);
    expect(requests).toHaveLength(0);
    client.dispose();
  });

  it('uses a server total and availability revision for an atomic hold', async () => {
    respond = () => ({ status: 201, body: {
      apiVersion: 'v1', id: 'hold-a', occurrenceId: 'occurrence-a',
      expiresAt: '2026-10-26T01:00:00Z',
      selection: [{ kind: 'seat', seatId: 'seat-a' }],
      total: { amountMinor: 12345, currency: 'RUB' },
      availabilityRevision: 8,
    } });
    const client = createHallApiClient({ baseURL });
    const hold = await client.createHold('occurrence-a', [{ kind: 'seat', seatId: 'seat-a' }], 'hold-123', 7);
    expect(hold.total.amountMinor).toBe(12345);
    expect(requests[0]).toMatchObject({
      method: 'POST', url: '/api/v1/occurrences/occurrence-a/holds',
      headers: { 'idempotency-key': 'hold-123' },
      body: { apiVersion: 'v1', availabilityRevision: 7, selection: [{ kind: 'seat', seatId: 'seat-a' }] },
    });
    client.dispose();
  });

  it('reads the pricing catalog and assignments and saves only IDs with revision and idempotency headers', async () => {
    const catalog = {
      apiVersion: 'v1', occurrenceId: 'occurrence-a', revision: 7,
      items: [{ id: 'vip', name: 'VIP', color: '#663399', status: 'active', price: { amountMinor: 9000, currency: 'RUB' } }],
    };
    const assignments = {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'occurrence-a',
      layoutVersionId: 'layout-a', revision: 5, catalogRevision: 7,
      assignments: { seatSegments: { 'seat-a': 'vip' }, gaZoneSegments: {} },
    };
    respond = (request) => {
      if (request.url.endsWith('/pricing-segments')) return { status: 200, body: catalog };
      if (request.url.endsWith('/pricing-assignments') && request.method === 'GET')
        return { status: 200, body: assignments };
      if (request.url.endsWith('/pricing-assignments') && request.method === 'PUT')
        return { status: 200, body: { ...assignments, revision: 6 } };
      return { status: 404, body: { apiVersion: 'v1', code: 'not_found', message: 'Missing' } };
    };
    const client = createHallApiClient({ baseURL, getToken: () => 'organizer-token' });
    expect((await client.getPricingSegments('occurrence-a')).revision).toBe(7);
    expect((await client.getPricingAssignments('occurrence-a')).revision).toBe(5);
    const saved = await client.savePricingAssignments('occurrence-a', {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'occurrence-a',
      layoutVersionId: 'layout-a', catalogRevision: 7,
      assignments: { seatSegments: { 'seat-a': 'vip' }, gaZoneSegments: {} },
    }, 5, 'pricing-save-1');

    expect(saved.revision).toBe(6);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/v1/occurrences/occurrence-a/pricing-segments',
      'GET /api/v1/occurrences/occurrence-a/pricing-assignments',
      'PUT /api/v1/occurrences/occurrence-a/pricing-assignments',
    ]);
    expect(requests[2]).toMatchObject({
      headers: {
        authorization: 'Bearer organizer-token',
        'if-match': '"5"',
        'idempotency-key': 'pricing-save-1',
      },
      body: {
        apiVersion: 'v1',
        occurrenceId: 'occurrence-a',
        layoutVersionId: 'layout-a',
        catalogRevision: 7,
        assignments: { seatSegments: { 'seat-a': 'vip' }, gaZoneSegments: {} },
      },
    });
    expect(requests[2]?.body).not.toHaveProperty('prices');
    client.dispose();
  });

  it('retries a read after a temporary server error but never retries a save', async () => {
    const draft = createEmptyDraft('API hall');
    respond = () => requests.length === 1
      ? { status: 503, body: { apiVersion: 'v1', code: 'service_unavailable', message: 'Busy' } }
      : { status: 200, body: {
          apiVersion: 'v1', id: draft.snapshot.id, revision: 1,
          updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 0, draft,
        } };
    const client = createHallApiClient({ baseURL });
    expect((await client.getHall(draft.snapshot.id)).revision).toBe(1);
    expect(requests).toHaveLength(2);
    requests = [];
    await expect(client.saveDraft(draft, 1, 'save-123')).rejects.toMatchObject({ code: 'service_unavailable' });
    expect(requests).toHaveLength(1);
    client.dispose();
  });

  it('cancels an in-flight read', async () => {
    respond = () => ({ status: 200, body: { apiVersion: 'v1' } });
    const client = createHallApiClient({ baseURL });
    const controller = new AbortController();
    controller.abort();
    await expect(client.getHall('hall-a', controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(requests).toHaveLength(0);
    client.dispose();
  });

  it('lists halls and publishes a draft with one revision check', async () => {
    const draft = createEmptyDraft('API hall');
    const record = {
      apiVersion: 'v1', id: draft.snapshot.id, revision: 3,
      updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 1, draft,
    };
    const published = {
      apiVersion: 'v1', versionId: 'version-a', hallId: draft.snapshot.id,
      versionNumber: 1, publishedAt: '2026-10-26T00:00:00Z', layout: draft,
    };
    respond = (request) => request.method === 'GET'
      ? { status: 200, body: { apiVersion: 'v1', items: [
          { apiVersion: 'v1', id: draft.snapshot.id, name: draft.hallName,
            updatedAt: record.updatedAt, revision: 2, publishedVersionNumber: 0,
            seats: 0, zones: 0 },
        ] } }
      : { status: 200, body: { apiVersion: 'v1', record, published } };
    const client = createHallApiClient({ baseURL });
    expect((await client.listHalls())[0]?.name).toBe('API hall');
    expect((await client.publishDraft(draft, 2, 'publish-123', true)).published.versionId).toBe('version-a');
    expect(requests[1]).toMatchObject({
      method: 'POST', url: `/api/v1/layouts/${draft.snapshot.id}/publish`,
      headers: { 'if-match': '"2"', 'idempotency-key': 'publish-123' },
      body: { apiVersion: 'v1', draft, warningsAcknowledged: true },
    });
    client.dispose();
  });

  it('reads an occurrence without trusting caller-provided availability or price', async () => {
    const draft = createEmptyDraft('API hall');
    respond = () => ({ status: 200, body: {
      apiVersion: 'v1', id: 'occurrence-a', title: 'Concert',
      startsAt: '2026-10-26T01:00:00Z', layoutVersionId: 'version-a',
      layout: { hallName: draft.hallName, snapshot: draft.snapshot, zoneBounds: {} },
      availability: { apiVersion: 'v1', revision: 4, seats: {}, zones: {} },
      prices: { apiVersion: 'v1', seats: {}, zones: {} }, ownHold: null,
    } });
    const client = createHallApiClient({ baseURL });
    const occurrence = await client.getOccurrence('occurrence-a');
    expect(occurrence.availability.revision).toBe(4);
    expect(requests[0]?.url).toBe('/api/v1/occurrences/occurrence-a');
    client.dispose();
  });

  it('creates, lists versions, reads a version, and deletes a hall', async () => {
    const draft = createEmptyDraft('API hall');
    const record = {
      apiVersion: 'v1', id: draft.snapshot.id, revision: 1,
      updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 1, draft,
    };
    const published = {
      apiVersion: 'v1', versionId: 'version-a', hallId: draft.snapshot.id,
      versionNumber: 1, publishedAt: '2026-10-26T00:00:00Z', layout: draft,
    };
    respond = (request) => {
      if (request.method === 'POST') return { status: 201, body: record };
      if (request.method === 'DELETE') return { status: 204, body: null };
      if (request.url?.endsWith('/versions'))
        return { status: 200, body: { apiVersion: 'v1', items: [published] } };
      return { status: 200, body: published };
    };
    const client = createHallApiClient({ baseURL });
    expect((await client.createHall(draft, 'create-123')).revision).toBe(1);
    expect((await client.listPublished(draft.snapshot.id))[0]?.versionId).toBe('version-a');
    expect((await client.getPublished('version-a')).layout).toEqual(draft);
    await client.deleteHall(draft.snapshot.id, 1, 'delete-123');
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /api/v1/halls',
      `GET /api/v1/layouts/${draft.snapshot.id}/versions`,
      'GET /api/v1/layout-versions/version-a',
      `DELETE /api/v1/halls/${draft.snapshot.id}`,
    ]);
    expect(requests[3]?.headers).toMatchObject({ 'if-match': '"1"', 'idempotency-key': 'delete-123' });
    client.dispose();
  });

  it('lists occurrences and keeps mutations idempotent through checkout', async () => {
    const draft = createEmptyDraft('API hall');
    const occurrence = {
      apiVersion: 'v1', id: 'occurrence-a', title: 'Concert',
      startsAt: '2026-10-26T01:00:00Z', layoutVersionId: 'version-a',
      layout: { hallName: draft.hallName, snapshot: draft.snapshot, zoneBounds: {} },
      availability: { apiVersion: 'v1', revision: 4, seats: {}, zones: {} },
      prices: { apiVersion: 'v1', seats: {}, zones: {} }, ownHold: null,
    };
    const order = {
      apiVersion: 'v1', id: 'order-a', occurrenceId: 'occurrence-a', holdId: 'hold-a',
      status: 'confirmed', selection: [{ kind: 'seat', seatId: 'seat-a' }],
      total: { amountMinor: 150000, currency: 'RUB' }, createdAt: '2026-10-26T00:00:00Z',
    };
    respond = (request) => {
      if (request.url === '/api/v1/occurrences')
        return { status: 200, body: { apiVersion: 'v1', items: [occurrence] } };
      if (request.method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: order };
    };
    const client = createHallApiClient({ baseURL });
    expect((await client.listOccurrences())[0]?.id).toBe('occurrence-a');
    await client.cancelHold('hold-a', 'cancel-123');
    expect((await client.createOrder('hold-a', 'order-123')).id).toBe('order-a');
    expect((await client.checkoutOrder('order-a', 'checkout-123')).status).toBe('confirmed');
    expect(requests.slice(1).map(({ headers }) => headers['idempotency-key'])).toEqual([
      'cancel-123', 'order-123', 'checkout-123',
    ]);
    client.dispose();
  });

  it('covers validation, assets and refreshed buyer reads with runtime checks', async () => {
    const draft = createEmptyDraft('API hall');
    const asset = { apiVersion: 'v1', id: 'asset-a', name: 'plan.pdf',
      contentType: 'application/pdf', sizeBytes: 42, sha256: 'a'.repeat(64) };
    respond = (request) => {
      if (request.url.endsWith('/validate')) return { status: 200, body: { apiVersion: 'v1', issues: [] } };
      if (request.url.endsWith('/upload-intents')) return { status: 201, body: {
        apiVersion: 'v1', assetId: 'asset-a', uploadUrl: 'https://assets.example/upload', expiresAt: '2026-10-26T12:00:00Z',
      } };
      if (request.url.endsWith('/seat-map')) return { status: 200, body: { hallName: draft.hallName, snapshot: draft.snapshot } };
      if (request.url.endsWith('/availability')) return { status: 200, body: { apiVersion: 'v1', revision: 2, seats: {}, zones: {} } };
      if (request.url.endsWith('/prices')) return { status: 200, body: { apiVersion: 'v1', seats: {}, zones: {} } };
      if (request.url === '/api/v1/holds/hold-a') return { status: 200, body: {
        apiVersion: 'v1', id: 'hold-a', occurrenceId: 'occurrence-a', expiresAt: '2026-10-26T12:00:00Z',
        selection: [{ kind: 'seat', seatId: 'seat-a' }], total: { amountMinor: 100, currency: 'RUB' }, availabilityRevision: 2,
      } };
      if (request.url === '/api/v1/orders/order-a') return { status: 200, body: {
        apiVersion: 'v1', id: 'order-a', occurrenceId: 'occurrence-a', holdId: 'hold-a', status: 'confirmed',
        selection: [{ kind: 'seat', seatId: 'seat-a' }], total: { amountMinor: 100, currency: 'RUB' }, createdAt: '2026-10-26T11:00:00Z',
      } };
      if (request.method === 'DELETE') return { status: 204, body: null };
      return { status: 200, body: asset };
    };
    const client = createHallApiClient({ baseURL });
    expect((await client.validateDraft(draft)).issues).toEqual([]);
    expect((await client.createAssetUploadIntent({ apiVersion: 'v1', name: 'plan.pdf', contentType: 'application/pdf', sizeBytes: 42, sha256: 'a'.repeat(64) }, 'upload-1')).assetId).toBe('asset-a');
    expect((await client.completeAssetUpload('asset-a', 'complete-1')).id).toBe('asset-a');
    expect((await client.getAsset('asset-a')).name).toBe('plan.pdf');
    expect((await client.getSeatMap('occurrence-a')).hallName).toBe('API hall');
    expect((await client.getAvailability('occurrence-a')).revision).toBe(2);
    expect((await client.getPrices('occurrence-a')).seats).toEqual({});
    expect((await client.getHold('hold-a')).id).toBe('hold-a');
    expect((await client.getOrder('order-a')).status).toBe('confirmed');
    await client.deleteAsset('asset-a', 'delete-1');
    expect(requests.filter(({ method }) => method === 'POST' || method === 'DELETE').map(({ headers }) => headers['idempotency-key']))
      .toEqual([undefined, 'upload-1', 'complete-1', 'delete-1']);
    client.dispose();
  });
});

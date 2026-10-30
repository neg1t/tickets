// @vitest-environment node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createHttpPurchaseDataSource } from './httpPurchaseDataSource.js';

const timestamp = '2026-10-30T12:00:00Z';

function sessionResult(purchaseSessionId: string, sessionCredential: string) {
  return {
    apiVersion: 'v2',
    purchaseSessionId,
    sessionCredential,
    expiresAt: '2026-10-30T13:00:00Z',
  };
}

const contextResult = {
  apiVersion: 'v2',
  summary: {
    occurrenceId: 'occ-1',
    eventId: 'event-1',
    title: 'Concert',
    startsAt: timestamp,
    timeZone: 'UTC',
    venue: { name: 'Hall', city: 'Yerevan' },
    salesStatus: 'open',
    currency: 'AMD',
    capabilities: { seats: true, generalAdmission: true },
  },
  layoutVersionId: 'layout-1',
  availabilityRevision: 1,
  pricingRevision: 1,
  serverTime: timestamp,
  ownHold: null,
  capabilities: { promoCode: false, emailVerification: false, paymentMode: 'none' },
};

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseURL: string) => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

describe('createHttpPurchaseDataSource session credentials', () => {
  it('uses the credential returned by createSession for later session requests', async () => {
    const sessionHeaders: string[] = [];
    let sessionCount = 0;
    await withServer((request, response) => {
      if (request.url?.endsWith('/sessions')) {
        sessionCount += 1;
        json(response, sessionResult(`session-${sessionCount}`, `credential-${sessionCount}`));
      } else {
        sessionHeaders.push(String(request.headers.authorization ?? ''));
        expect(request.headers['x-purchase-session-id']).toBe('session-1');
        json(response, contextResult);
      }
    }, async (baseURL) => {
      const source = createHttpPurchaseDataSource({ baseURL });
      const created = await source.createSession({ occurrenceId: 'occ-1' }, 'session-create-1');
      await source.getContext(created.purchaseSessionId, 'occ-1');
    });

    expect(sessionHeaders).toEqual(['Bearer credential-1']);
  });

  it('keeps credentials isolated for multiple created sessions', async () => {
    const sessionHeaders: string[] = [];
    const sessionIds: string[] = [];
    let sessionCount = 0;
    await withServer((request, response) => {
      if (request.url?.endsWith('/sessions')) {
        sessionCount += 1;
        json(response, sessionResult(`session-${sessionCount}`, `credential-${sessionCount}`));
      } else {
        sessionHeaders.push(String(request.headers.authorization ?? ''));
        sessionIds.push(String(request.headers['x-purchase-session-id'] ?? ''));
        json(response, contextResult);
      }
    }, async (baseURL) => {
      const source = createHttpPurchaseDataSource({ baseURL });
      const first = await source.createSession({ occurrenceId: 'occ-1' }, 'session-create-1');
      const second = await source.createSession({ occurrenceId: 'occ-1' }, 'session-create-2');
      await source.getContext(first.purchaseSessionId, 'occ-1');
      await source.getContext(second.purchaseSessionId, 'occ-1');
    });

    expect(sessionHeaders).toEqual(['Bearer credential-1', 'Bearer credential-2']);
    expect(sessionIds).toEqual(['session-1', 'session-2']);
  });

  it('falls back to the host credential provider for externally created sessions', async () => {
    const hostProvider = vi.fn((sessionId: string) => `host-${sessionId}`);
    let authorization = '';
    await withServer((request, response) => {
      authorization = String(request.headers.authorization ?? '');
      json(response, contextResult);
    }, async (baseURL) => {
      const source = createHttpPurchaseDataSource({ baseURL, getSessionCredential: hostProvider });
      await source.getContext('host-session', 'occ-1');
    });

    expect(hostProvider).toHaveBeenCalledWith('host-session');
    expect(authorization).toBe('Bearer host-host-session');
  });
});

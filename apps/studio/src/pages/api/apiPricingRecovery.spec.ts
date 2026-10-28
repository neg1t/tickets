import { describe, expect, it } from 'vitest';
import { createEmptyDraft, pricingAssignmentDocumentSchema } from '@hall-platform/domain';
import type { PricingPageData } from './pricingPage.model.js';
import { createPricingSaveAttempt } from './pricingPage.model.js';
import {
  apiPricingRecoveryStorageKey,
  clearApiPricingRecovery,
  createApiPricingRecoveryRecord,
  readApiPricingRecovery,
  resolveApiPricingRecovery,
  saveApiPricingRecovery,
} from './apiPricingRecovery.js';

const apiBaseUrl = 'https://api.example.test/v1';
const snapshot = createEmptyDraft('API Hall').snapshot;
const baselineDocument = pricingAssignmentDocumentSchema.parse({
  schemaVersion: 1,
  occurrenceId: 'occ-1',
  layoutVersionId: snapshot.layoutVersionId,
  revision: 3,
  catalogRevision: 7,
  assignments: { seatSegments: { 'seat-a': 'standard' }, gaZoneSegments: {} },
});
const draft = {
  ...baselineDocument,
  assignments: { seatSegments: { 'seat-a': 'vip', 'seat-b': 'vip' }, gaZoneSegments: {} },
};
const data: PricingPageData = {
  occurrence: {
    apiVersion: 'v1', id: 'occ-1', title: 'Concert', startsAt: '2026-10-26T01:00:00Z',
    layoutVersionId: snapshot.layoutVersionId, layout: { hallName: 'API Hall', snapshot },
    availability: { apiVersion: 'v1', revision: 1, seats: {}, zones: {} },
    prices: { apiVersion: 'v1', seats: {}, zones: {} }, ownHold: null,
  },
  catalog: {
    occurrenceId: 'occ-1', revision: 7,
    items: [{ id: 'vip', name: 'VIP', color: '#663399', status: 'active', price: { amountMinor: 9000, currency: 'RUB' } }],
  },
  document: baselineDocument,
};

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('API pricing recovery', () => {
  it('persists a dirty draft and restores it only against the same server baseline', () => {
    const storage = createStorage();
    const record = createApiPricingRecoveryRecord({
      apiBaseUrl,
      baseline: data,
      document: draft,
      updatedAt: 100,
    });
    saveApiPricingRecovery(storage, record);

    const recovery = readApiPricingRecovery(storage, apiBaseUrl, 'occ-1', snapshot.layoutVersionId);
    expect(recovery.kind).toBe('record');
    if (recovery.kind !== 'record') return;
    expect(resolveApiPricingRecovery(recovery.record, apiBaseUrl, data)).toEqual({
      kind: 'restore-draft', document: draft,
    });
    expect(JSON.stringify(recovery.record)).not.toContain('authorization');
  });

  it('restores an ambiguous request with its original key and body for explicit retry', () => {
    const storage = createStorage();
    const attempt = createPricingSaveAttempt(draft, 'same-pricing-key');
    const record = createApiPricingRecoveryRecord({
      apiBaseUrl,
      baseline: data,
      document: draft,
      pendingAttempt: attempt,
      updatedAt: 100,
    });
    saveApiPricingRecovery(storage, record);

    const recovery = readApiPricingRecovery(storage, apiBaseUrl, 'occ-1', snapshot.layoutVersionId);
    expect(recovery.kind).toBe('record');
    if (recovery.kind !== 'record') return;
    const resolved = resolveApiPricingRecovery(recovery.record, apiBaseUrl, data);
    expect(resolved).toEqual({ kind: 'retry', document: draft, attempt });
  });

  it('recognizes an already-applied attempt and preserves drafts that conflict with the latest baseline', () => {
    const attempt = createPricingSaveAttempt(draft, 'same-pricing-key');
    const record = createApiPricingRecoveryRecord({
      apiBaseUrl,
      baseline: data,
      document: draft,
      pendingAttempt: attempt,
      updatedAt: 100,
    });
    const savedBaseline: PricingPageData = {
      ...data,
      document: { ...draft, revision: baselineDocument.revision + 1 },
    };
    expect(resolveApiPricingRecovery(record, apiBaseUrl, savedBaseline)).toEqual({ kind: 'already-saved' });

    const conflictingBaseline: PricingPageData = {
      ...data,
      document: { ...baselineDocument, revision: baselineDocument.revision + 1 },
    };
    expect(resolveApiPricingRecovery(record, apiBaseUrl, conflictingBaseline)).toEqual({
      kind: 'conflict', document: draft, pendingAttempt: attempt,
    });
  });

  it('keeps separate recovery keys for different servers, strips URL credentials, and clears explicitly', () => {
    const storage = createStorage();
    const record = createApiPricingRecoveryRecord({
      apiBaseUrl: 'https://api.example.test/v1?access_token=secret',
      baseline: data,
      document: draft,
      updatedAt: 100,
    });
    const key = apiPricingRecoveryStorageKey(
      'https://api.example.test/v1?access_token=secret', 'occ-1', snapshot.layoutVersionId,
    );
    expect(key).not.toContain('secret');
    saveApiPricingRecovery(storage, record);
    expect(readApiPricingRecovery(storage, apiBaseUrl, 'occ-1', snapshot.layoutVersionId).kind).toBe('record');
    expect(readApiPricingRecovery(storage, 'https://other.example.test/v1', 'occ-1', snapshot.layoutVersionId).kind).toBe('missing');
    clearApiPricingRecovery(storage, apiBaseUrl, 'occ-1', snapshot.layoutVersionId);
    expect(readApiPricingRecovery(storage, apiBaseUrl, 'occ-1', snapshot.layoutVersionId).kind).toBe('missing');
  });

  it('reports malformed stored recovery without applying it', () => {
    const storage = createStorage();
    const key = apiPricingRecoveryStorageKey(apiBaseUrl, 'occ-1', snapshot.layoutVersionId);
    storage.setItem(key, '{broken-json');
    expect(readApiPricingRecovery(storage, apiBaseUrl, 'occ-1', snapshot.layoutVersionId)).toEqual({ kind: 'invalid' });
  });
});

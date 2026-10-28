import { describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '@hall-platform/domain';
import type { ApiOccurrence } from '@hall-platform/api-contracts';
import {
  createApiPricingAssignmentsWrite,
  createPricingSaveAttempt,
  loadPricingPageData,
  mapApiPricingAssignments,
  samePricingAssignments,
} from './pricingPage.model.js';

const snapshot = createEmptyDraft('API Hall').snapshot;
const occurrence: ApiOccurrence = {
  apiVersion: 'v1',
  id: 'occ-1',
  title: 'Concert',
  startsAt: '2026-10-26T01:00:00Z',
  layoutVersionId: snapshot.layoutVersionId,
  layout: { hallName: 'API Hall', snapshot },
  availability: { apiVersion: 'v1', revision: 1, seats: {}, zones: {} },
  prices: { apiVersion: 'v1', seats: {}, zones: {} },
  ownHold: null,
};
const assignmentResponse = {
  apiVersion: 'v1' as const,
  schemaVersion: 1 as const,
  occurrenceId: 'occ-1',
  layoutVersionId: snapshot.layoutVersionId,
  revision: 3,
  catalogRevision: 7,
  assignments: { seatSegments: { 'seat-a': 'vip' }, gaZoneSegments: {} },
};

describe('API pricing page model', () => {
  it('loads API-owned data and keeps layout/catalog context attached', async () => {
    const client = {
      getOccurrence: vi.fn(async () => occurrence),
      getPricingSegments: vi.fn(async () => ({
        apiVersion: 'v1' as const,
        occurrenceId: 'occ-1', revision: 7,
        items: [{ id: 'vip', name: 'VIP', color: '#663399', status: 'active' as const, price: { amountMinor: 9000, currency: 'RUB' } }],
      })),
      getPricingAssignments: vi.fn(async () => assignmentResponse),
    };
    const data = await loadPricingPageData(client, 'occ-1');

    expect(client.getOccurrence).toHaveBeenCalledWith('occ-1', undefined);
    expect(data.catalog.revision).toBe(7);
    expect(data.document).toEqual(mapApiPricingAssignments(assignmentResponse));
  });

  it('rejects assignments for a different published layout version', async () => {
    const client = {
      getOccurrence: async () => occurrence,
      getPricingSegments: async () => ({ apiVersion: 'v1' as const, occurrenceId: 'occ-1', revision: 7, items: [] }),
      getPricingAssignments: async () => ({ ...assignmentResponse, layoutVersionId: 'old-layout' }),
    };
    await expect(loadPricingPageData(client, 'occ-1')).rejects.toMatchObject({
      code: 'layout_version_conflict',
    });
  });

  it('sends only context and target segment IDs and keeps an idempotency key on retry', () => {
    const document = mapApiPricingAssignments(assignmentResponse);
    const firstAttempt = createPricingSaveAttempt(document, 'same-pricing-key');
    const retryAttempt = createPricingSaveAttempt(document, firstAttempt.idempotencyKey);

    expect(firstAttempt.body).toEqual(createApiPricingAssignmentsWrite(document));
    expect(firstAttempt.body.assignments).toEqual({
      seatSegments: { 'seat-a': 'vip' },
      gaZoneSegments: {},
    });
    expect(firstAttempt.body).not.toHaveProperty('prices');
    expect(retryAttempt.idempotencyKey).toBe(firstAttempt.idempotencyKey);
    expect(samePricingAssignments(document, { ...document, revision: 99 })).toBe(true);
  });
});

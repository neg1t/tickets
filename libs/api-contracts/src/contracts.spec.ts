import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from '@hall-platform/domain';
import {
  apiHallRecordSchema,
  apiMoneySchema,
  apiHoldRequestSchema,
  apiIdempotencyKeySchema,
  apiErrorSchema,
  apiAssetUploadRequestSchema,
  apiValidationResultSchema,
} from './contracts.js';

describe('versioned API contracts', () => {
  it('accepts only safe integer minor amounts with an ISO currency', () => {
    expect(apiMoneySchema.parse({ amountMinor: 150050, currency: 'RUB' }))
      .toEqual({ amountMinor: 150050, currency: 'RUB' });
    expect(apiMoneySchema.safeParse({ amountMinor: 15.5, currency: 'RUB' }).success).toBe(false);
    expect(apiMoneySchema.safeParse({ amountMinor: -1, currency: 'RUB' }).success).toBe(false);
    expect(apiMoneySchema.safeParse({ amountMinor: 1, currency: 'FAKE' }).success).toBe(false);
  });

  it('rejects malformed hall payloads at the network boundary', () => {
    expect(apiHallRecordSchema.safeParse({ apiVersion: 'v1', id: 'hall-a', revision: 1, draft: {} }).success).toBe(false);
    const draft = createEmptyDraft('API hall');
    expect(apiHallRecordSchema.parse({
      apiVersion: 'v1', id: draft.snapshot.id, revision: 1,
      updatedAt: '2026-10-26T00:00:00Z', publishedVersionNumber: 0, draft,
    }).draft).toEqual(draft);
  });

  it('requires a bounded idempotency key and prevents invalid hold selections', () => {
    expect(apiIdempotencyKeySchema.safeParse('').success).toBe(false);
    expect(apiIdempotencyKeySchema.safeParse('request-123').success).toBe(true);
    const request = {
      apiVersion: 'v1',
      selection: [
        { kind: 'seat', seatId: 'seat-a' },
        { kind: 'seat', seatId: 'seat-a' },
      ],
    };
    expect(apiHoldRequestSchema.safeParse(request).success).toBe(false);
    expect(apiHoldRequestSchema.safeParse({
      ...request,
      selection: [{ kind: 'generalAdmission', zoneId: 'zone-a', quantity: 1.5 }],
    }).success).toBe(false);
  });

  it('validates structured conflict errors', () => {
    expect(apiErrorSchema.parse({ apiVersion: 'v1', code: 'revision_conflict', message: 'Changed', currentRevision: 4 })).toMatchObject({ currentRevision: 4 });
    expect(apiErrorSchema.safeParse({ apiVersion: 'v1', code: 'other', message: 'x' }).success).toBe(false);
  });

  it('validates asset metadata and backend validation results', () => {
    const upload = { apiVersion: 'v1', name: 'plan.pdf', contentType: 'application/pdf',
      sizeBytes: 42, sha256: 'a'.repeat(64) };
    expect(apiAssetUploadRequestSchema.parse(upload)).toEqual(upload);
    expect(apiAssetUploadRequestSchema.safeParse({ ...upload, contentType: 'text/html' }).success).toBe(false);
    expect(apiValidationResultSchema.parse({ apiVersion: 'v1', issues: [
      { severity: 'warning', code: 'seat_gap', message: 'Check spacing' },
    ] }).issues).toHaveLength(1);
  });
});

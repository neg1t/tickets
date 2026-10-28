import { z } from 'zod';
import {
  apiIdempotencyKeySchema,
  apiPricingAssignmentsWriteSchema,
} from '@hall-platform/api-contracts';
import {
  pricingAssignmentDocumentSchema,
  type PricingAssignmentDocument,
} from '@hall-platform/domain';
import type { PricingSaveAttempt, PricingPageData } from './pricingPage.model.js';
import { samePricingAssignments } from './pricingPage.model.js';

const recoveryPrefix = 'hall-platform:api-pricing-recovery:v1';

const pricingSaveAttemptSchema = z.object({
  idempotencyKey: apiIdempotencyKeySchema,
  expectedRevision: z.number().int().nonnegative(),
  document: pricingAssignmentDocumentSchema,
  body: apiPricingAssignmentsWriteSchema,
});

const apiPricingRecoverySchema = z.object({
  schemaVersion: z.literal(1),
  apiBaseUrl: z.string().min(1),
  occurrenceId: z.string().min(1),
  layoutVersionId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  catalogRevision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  document: pricingAssignmentDocumentSchema,
  pendingAttempt: pricingSaveAttemptSchema.nullable(),
}).superRefine((record, context) => {
  if (record.document.occurrenceId !== record.occurrenceId ||
      record.document.layoutVersionId !== record.layoutVersionId ||
      record.document.revision !== record.baseRevision ||
      record.document.catalogRevision !== record.catalogRevision) {
    context.addIssue({ code: 'custom', message: 'Recovery document context does not match its baseline' });
  }

  const attempt = record.pendingAttempt;
  if (!attempt) return;
  if (
    attempt.document.occurrenceId !== record.occurrenceId ||
    attempt.document.layoutVersionId !== record.layoutVersionId ||
    attempt.document.revision !== record.baseRevision ||
    attempt.document.catalogRevision !== record.catalogRevision ||
    attempt.expectedRevision !== record.baseRevision ||
    attempt.body.occurrenceId !== record.occurrenceId ||
    attempt.body.layoutVersionId !== record.layoutVersionId ||
    attempt.body.catalogRevision !== record.catalogRevision ||
    JSON.stringify(attempt.document.assignments) !== JSON.stringify(record.document.assignments) ||
    JSON.stringify(attempt.body.assignments) !== JSON.stringify(record.document.assignments)
  ) {
    context.addIssue({ code: 'custom', message: 'Pending pricing attempt does not match its recovery document' });
  }
});

export type ApiPricingRecoveryRecord = z.infer<typeof apiPricingRecoverySchema>;
export type ApiPricingRecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ApiPricingRecoveryRead =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'record'; record: ApiPricingRecoveryRecord }>;

export type ApiPricingRecoveryResolution =
  | Readonly<{ kind: 'restore-draft'; document: PricingAssignmentDocument }>
  | Readonly<{ kind: 'retry'; document: PricingAssignmentDocument; attempt: PricingSaveAttempt }>
  | Readonly<{ kind: 'already-saved' }>
  | Readonly<{
      kind: 'conflict';
      document: PricingAssignmentDocument;
      pendingAttempt: PricingSaveAttempt | null;
    }>;

function normalizedApiBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return value.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

export function apiPricingRecoveryStorageKey(
  apiBaseUrl: string,
  occurrenceId: string,
  layoutVersionId: string,
): string {
  return [
    recoveryPrefix,
    encodeURIComponent(normalizedApiBaseUrl(apiBaseUrl)),
    encodeURIComponent(occurrenceId),
    encodeURIComponent(layoutVersionId),
  ].join(':');
}

export function createApiPricingRecoveryRecord(input: Readonly<{
  apiBaseUrl: string;
  baseline: PricingPageData;
  document: PricingAssignmentDocument;
  pendingAttempt?: PricingSaveAttempt | null;
  updatedAt?: number;
}>): ApiPricingRecoveryRecord {
  return apiPricingRecoverySchema.parse({
    schemaVersion: 1,
    apiBaseUrl: normalizedApiBaseUrl(input.apiBaseUrl),
    occurrenceId: input.baseline.document.occurrenceId,
    layoutVersionId: input.baseline.document.layoutVersionId,
    baseRevision: input.baseline.document.revision,
    catalogRevision: input.baseline.catalog.revision,
    updatedAt: input.updatedAt ?? Date.now(),
    document: input.document,
    pendingAttempt: input.pendingAttempt ?? null,
  });
}

export function saveApiPricingRecovery(
  storage: ApiPricingRecoveryStorage,
  record: ApiPricingRecoveryRecord,
): void {
  const validRecord = apiPricingRecoverySchema.parse(record);
  const key = apiPricingRecoveryStorageKey(
    validRecord.apiBaseUrl,
    validRecord.occurrenceId,
    validRecord.layoutVersionId,
  );
  storage.setItem(key, JSON.stringify(validRecord));
}

export function readApiPricingRecovery(
  storage: ApiPricingRecoveryStorage,
  apiBaseUrl: string,
  occurrenceId: string,
  layoutVersionId: string,
): ApiPricingRecoveryRead {
  const key = apiPricingRecoveryStorageKey(apiBaseUrl, occurrenceId, layoutVersionId);
  const stored = storage.getItem(key);
  if (stored === null) return { kind: 'missing' };
  try {
    const parsed = apiPricingRecoverySchema.safeParse(JSON.parse(stored));
    return parsed.success ? { kind: 'record', record: parsed.data } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

export function clearApiPricingRecovery(
  storage: ApiPricingRecoveryStorage,
  apiBaseUrl: string,
  occurrenceId: string,
  layoutVersionId: string,
): void {
  storage.removeItem(apiPricingRecoveryStorageKey(apiBaseUrl, occurrenceId, layoutVersionId));
}

export function resolveApiPricingRecovery(
  record: ApiPricingRecoveryRecord,
  apiBaseUrl: string,
  baseline: PricingPageData,
): ApiPricingRecoveryResolution {
  const contextMatches =
    record.apiBaseUrl === normalizedApiBaseUrl(apiBaseUrl) &&
    record.occurrenceId === baseline.occurrence.id &&
    record.layoutVersionId === baseline.occurrence.layoutVersionId &&
    record.layoutVersionId === baseline.document.layoutVersionId &&
    record.document.occurrenceId === baseline.document.occurrenceId;
  if (!contextMatches) {
    return {
      kind: 'conflict',
      document: record.document,
      pendingAttempt: record.pendingAttempt,
    };
  }

  const catalogMatches = record.catalogRevision === baseline.catalog.revision &&
    record.catalogRevision === baseline.document.catalogRevision;
  const revisionMatches = record.baseRevision === baseline.document.revision;
  if (record.pendingAttempt) {
    if (revisionMatches && catalogMatches) {
      return { kind: 'retry', document: record.document, attempt: record.pendingAttempt };
    }
    if (
      baseline.document.revision > record.baseRevision &&
      catalogMatches &&
      samePricingAssignments(record.document, baseline.document)
    ) return { kind: 'already-saved' };
    return {
      kind: 'conflict',
      document: record.document,
      pendingAttempt: record.pendingAttempt,
    };
  }

  if (revisionMatches && catalogMatches) {
    if (samePricingAssignments(record.document, baseline.document)) return { kind: 'already-saved' };
    return { kind: 'restore-draft', document: record.document };
  }
  return { kind: 'conflict', document: record.document, pendingAttempt: null };
}

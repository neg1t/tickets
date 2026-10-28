import {
  pricingAssignmentDocumentSchema,
  type PricingAssignmentDocument,
  type PricingCatalog,
} from '@hall-platform/domain';
import type {
  ApiOccurrence,
  ApiPricingAssignments,
  ApiPricingAssignmentsWrite,
  ApiPricingCatalog,
} from '@hall-platform/api-contracts';
import { apiPricingAssignmentsWriteSchema } from '@hall-platform/api-contracts';
import { HallApiError } from '@hall-platform/api-axios';

export type PricingPageClient = Readonly<{
  getOccurrence: (id: string, signal?: AbortSignal) => Promise<ApiOccurrence>;
  getPricingSegments: (id: string, signal?: AbortSignal) => Promise<ApiPricingCatalog>;
  getPricingAssignments: (id: string, signal?: AbortSignal) => Promise<ApiPricingAssignments>;
}>;

export type PricingPageData = Readonly<{
  occurrence: ApiOccurrence;
  catalog: PricingCatalog;
  document: PricingAssignmentDocument;
}>;

export type PricingSaveAttempt = Readonly<{
  idempotencyKey: string;
  expectedRevision: number;
  document: PricingAssignmentDocument;
  body: ApiPricingAssignmentsWrite;
}>;

export function mapApiPricingCatalog(catalog: ApiPricingCatalog): PricingCatalog {
  return {
    occurrenceId: catalog.occurrenceId,
    revision: catalog.revision,
    items: catalog.items,
  };
}

export function mapApiPricingAssignments(
  assignments: ApiPricingAssignments,
): PricingAssignmentDocument {
  return pricingAssignmentDocumentSchema.parse({
    schemaVersion: assignments.schemaVersion,
    occurrenceId: assignments.occurrenceId,
    layoutVersionId: assignments.layoutVersionId,
    revision: assignments.revision,
    catalogRevision: assignments.catalogRevision,
    assignments: assignments.assignments,
  });
}

export function createApiPricingAssignmentsWrite(
  document: PricingAssignmentDocument,
): ApiPricingAssignmentsWrite {
  return apiPricingAssignmentsWriteSchema.parse({
    apiVersion: 'v1',
    schemaVersion: document.schemaVersion,
    occurrenceId: document.occurrenceId,
    layoutVersionId: document.layoutVersionId,
    catalogRevision: document.catalogRevision,
    assignments: document.assignments,
  });
}

export function createPricingSaveAttempt(
  document: PricingAssignmentDocument,
  idempotencyKey: string = crypto.randomUUID(),
): PricingSaveAttempt {
  return {
    idempotencyKey,
    expectedRevision: document.revision,
    document,
    body: createApiPricingAssignmentsWrite(document),
  };
}

export function samePricingAssignments(
  first: PricingAssignmentDocument,
  second: PricingAssignmentDocument,
): boolean {
  const sameMap = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([id, segmentId]) => b[id] === segmentId);
  return (
    first.catalogRevision === second.catalogRevision &&
    sameMap(first.assignments.seatSegments, second.assignments.seatSegments) &&
    sameMap(first.assignments.gaZoneSegments, second.assignments.gaZoneSegments)
  );
}

export async function loadPricingPageData(
  client: PricingPageClient,
  occurrenceId: string,
  signal?: AbortSignal,
): Promise<PricingPageData> {
  const [occurrence, rawCatalog, rawAssignments] = await Promise.all([
    client.getOccurrence(occurrenceId, signal),
    client.getPricingSegments(occurrenceId, signal),
    client.getPricingAssignments(occurrenceId, signal),
  ]);
  const catalog = mapApiPricingCatalog(rawCatalog);
  const document = mapApiPricingAssignments(rawAssignments);
  if (
    occurrence.id !== occurrenceId ||
    catalog.occurrenceId !== occurrenceId ||
    document.occurrenceId !== occurrenceId
  ) throw new HallApiError('invalid_response', 'Pricing data occurrence does not match the selected event');
  if (
    occurrence.layoutVersionId !== occurrence.layout.snapshot.layoutVersionId ||
    document.layoutVersionId !== occurrence.layoutVersionId
  ) throw new HallApiError('layout_version_conflict', 'Pricing assignments belong to another published layout version');
  return { occurrence, catalog, document };
}

import { z } from 'zod';
import type { LayoutSnapshot } from '../model/layoutSnapshot.js';
import { getPricingCatalogDiagnostics, type PricingCatalog } from './pricingCatalog.js';

const segmentReferenceSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

const assignmentMapSchema = z.record(z.string().min(1), segmentReferenceSchema);

export const pricingAssignmentsSchema = z.strictObject({
  seatSegments: assignmentMapSchema,
  gaZoneSegments: assignmentMapSchema,
});

export type PricingAssignments = z.infer<typeof pricingAssignmentsSchema>;

export const pricingAssignmentDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurrenceId: z.string().min(1),
  layoutVersionId: z.string().min(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  catalogRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  assignments: pricingAssignmentsSchema,
});

export type PricingAssignmentDocument = z.infer<
  typeof pricingAssignmentDocumentSchema
>;

export type PricingAssignmentValidationIssue = Readonly<{
  severity: 'error';
  code:
    | 'occurrence_context_mismatch'
    | 'layout_context_mismatch'
    | 'catalog_context_mismatch'
    | 'catalog_revision_mismatch'
    | 'invalid_document'
    | 'mixed_catalog_currency'
    | 'unknown_seat'
    | 'unknown_zone'
    | 'not_ga_zone'
    | 'unknown_segment'
    | 'archived_segment';
  targetId?: string;
  message: string;
}>;

export type PricingAssignmentValidationContext = Readonly<{
  occurrenceId: string;
  layoutVersionId: string;
  snapshot: LayoutSnapshot;
  catalog: PricingCatalog;
}>;

export function validatePricingAssignments(
  value: unknown,
  context: PricingAssignmentValidationContext,
): PricingAssignmentValidationIssue[] {
  const parsed = pricingAssignmentDocumentSchema.safeParse(value);
  if (!parsed.success) {
    return [
      {
        severity: 'error',
        code: 'invalid_document',
        message: 'Pricing assignment document has an invalid structure.',
      },
    ];
  }
  const document = parsed.data;
  const issues: PricingAssignmentValidationIssue[] = [];
  const add = (
    code: PricingAssignmentValidationIssue['code'],
    message: string,
    targetId?: string,
  ) => {
    issues.push({
      severity: 'error',
      code,
      message,
      ...(targetId ? { targetId } : {}),
    });
  };

  if (document.occurrenceId !== context.occurrenceId) {
    add('occurrence_context_mismatch', 'Assignment occurrence does not match.');
  }
  if (
    document.layoutVersionId !== context.layoutVersionId ||
    document.layoutVersionId !== context.snapshot.layoutVersionId
  ) {
    add('layout_context_mismatch', 'Assignment layout version does not match.');
  }
  if (context.catalog.occurrenceId !== context.occurrenceId) {
    add('catalog_context_mismatch', 'Catalog occurrence does not match.');
  }
  if (document.catalogRevision !== context.catalog.revision) {
    add('catalog_revision_mismatch', 'Pricing catalog changed; review it before saving.');
  }
  if (getPricingCatalogDiagnostics(context.catalog).length > 0) {
    add(
      'mixed_catalog_currency',
      'Pricing segments use different currencies and cannot be applied together.',
    );
  }

  const seatsById = new Set<string>(
    context.snapshot.seats.map(({ id }) => id),
  );
  const zonesById = new Map<string, (typeof context.snapshot.zones)[number]>(
    context.snapshot.zones.map((zone) => [zone.id, zone]),
  );
  const segmentsById = new Map(
    context.catalog.items.map((segment) => [segment.id, segment]),
  );

  const validateSegment = (targetId: string, segmentId: string) => {
    const segment = segmentsById.get(segmentId);
    if (!segment) {
      add('unknown_segment', `Pricing segment ${segmentId} is no longer available.`, targetId);
    } else if (segment.status !== 'active') {
      add('archived_segment', `Pricing segment ${segment.name} is archived.`, targetId);
    }
  };

  for (const [seatId, segmentId] of Object.entries(
    document.assignments.seatSegments,
  )) {
    if (!seatsById.has(seatId)) {
      add('unknown_seat', `Seat ${seatId} is not in this layout version.`, seatId);
    }
    validateSegment(seatId, segmentId);
  }

  for (const [zoneId, segmentId] of Object.entries(
    document.assignments.gaZoneSegments,
  )) {
    const zone = zonesById.get(zoneId);
    if (!zone) {
      add('unknown_zone', `Zone ${zoneId} is not in this layout version.`, zoneId);
    } else if (zone.kind !== 'ga') {
      add('not_ga_zone', `Zone ${zone.name} is not a general admission zone.`, zoneId);
    }
    validateSegment(zoneId, segmentId);
  }

  return issues;
}

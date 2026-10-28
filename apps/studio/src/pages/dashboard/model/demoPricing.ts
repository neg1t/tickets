import {
  pricingAssignmentDocumentSchema,
  type PricingAssignmentDocument,
  type PricingCatalog,
} from '@hall-platform/domain';
import type { SeatPriceMap } from '@hall-platform/seat-view';
import { createPricingPreviewPriceMap } from '@hall-platform/pricing-editor';
import type { DemoOccurrence } from './demoBooking.js';
import { z } from 'zod';

export const demoPricingAssignmentRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurrenceId: z.string().min(1),
  document: pricingAssignmentDocumentSchema,
});

export type DemoPricingAssignmentRecord = z.infer<
  typeof demoPricingAssignmentRecordSchema
>;

export const demoPricingRecoveryRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurrenceId: z.string().min(1),
  layoutVersionId: z.string().min(1),
  baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  catalogRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  document: pricingAssignmentDocumentSchema,
  updatedAt: z.number().finite(),
});

export type DemoPricingRecoveryRecord = z.infer<
  typeof demoPricingRecoveryRecordSchema
>;

export const demoPricingCatalogRevision = 1;

export function createDemoPricingCatalog(occurrence: DemoOccurrence): PricingCatalog {
  return {
    occurrenceId: occurrence.id,
    revision: demoPricingCatalogRevision,
    items: [
      {
        id: 'demo:standard',
        name: 'Стандарт',
        color: '#2b7b68',
        status: 'active',
        price: { amountMinor: 150000, currency: 'RUB' },
      },
      {
        id: 'demo:comfort',
        name: 'Комфорт',
        color: '#bd8424',
        status: 'active',
        price: { amountMinor: 220000, currency: 'RUB' },
      },
      {
        id: 'demo:premium',
        name: 'Премиум',
        color: '#784fa3',
        status: 'active',
        price: { amountMinor: 350000, currency: 'RUB' },
      },
    ],
  };
}

export function createDemoPricingDocument(
  occurrence: DemoOccurrence,
  catalog: PricingCatalog,
  assignments: PricingAssignmentDocument['assignments'] = {
    seatSegments: {},
    gaZoneSegments: {},
  },
  revision = 0,
): PricingAssignmentDocument {
  return {
    schemaVersion: 1,
    occurrenceId: occurrence.id,
    layoutVersionId: occurrence.layout.snapshot.layoutVersionId,
    revision,
    catalogRevision: catalog.revision,
    assignments,
  };
}

export function buildDemoPricingPrices(input: {
  occurrence: DemoOccurrence;
  catalog: PricingCatalog;
  document: PricingAssignmentDocument;
}): SeatPriceMap {
  return createPricingPreviewPriceMap({
    snapshot: input.occurrence.layout.snapshot,
    catalog: input.catalog,
    document: input.document,
  });
}

import { z } from 'zod';
import {
  pricingAssignmentsSchema,
  pricingSegmentSchema,
} from '@hall-platform/domain';
import { apiVersionSchema } from './contracts.js';

const idSchema = z.string().min(1).max(200).refine((value) => value.trim() === value);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const apiPricingCatalogSchema = z
  .strictObject({
    apiVersion: apiVersionSchema,
    occurrenceId: idSchema,
    revision: revisionSchema,
    items: z.array(pricingSegmentSchema),
  })
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    catalog.items.forEach((item, index) => {
      if (ids.has(item.id))
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `Duplicate pricing segment ID: ${item.id}`,
        });
      ids.add(item.id);
    });
  });
export type ApiPricingCatalog = z.infer<typeof apiPricingCatalogSchema>;

export const apiPricingAssignmentsWriteSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  schemaVersion: z.literal(1),
  occurrenceId: idSchema,
  layoutVersionId: idSchema,
  catalogRevision: revisionSchema,
  assignments: pricingAssignmentsSchema,
});
export type ApiPricingAssignmentsWrite = z.infer<
  typeof apiPricingAssignmentsWriteSchema
>;

export const apiPricingAssignmentsSchema = apiPricingAssignmentsWriteSchema.extend({
  revision: revisionSchema,
});
export type ApiPricingAssignments = z.infer<typeof apiPricingAssignmentsSchema>;

export const apiPricingIssueSchema = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
  targetId: idSchema.optional(),
});
export type ApiPricingIssue = z.infer<typeof apiPricingIssueSchema>;

import { z } from 'zod';
import {
  hallLayoutDraftSchema,
  layoutSnapshotSchema,
  pricingMoneySchema,
  seatStatusSchema,
} from '@hall-platform/domain';

export const apiVersionSchema = z.literal('v1');
export const apiIdempotencyKeySchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const idSchema = z.string().min(1).max(200).refine((id) => id.trim() === id);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const dateTimeSchema = z.iso.datetime({ offset: true });
export const apiMoneySchema = pricingMoneySchema;
export type ApiMoney = z.infer<typeof apiMoneySchema>;

export const apiHallSummarySchema = z.strictObject({
  apiVersion: apiVersionSchema,
  id: idSchema,
  name: z.string().min(1),
  updatedAt: dateTimeSchema,
  revision: revisionSchema,
  publishedVersionNumber: revisionSchema,
  seats: revisionSchema,
  zones: revisionSchema,
});
export type ApiHallSummary = z.infer<typeof apiHallSummarySchema>;
export const apiHallListSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  items: z.array(apiHallSummarySchema),
});

export const apiHallRecordSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  id: idSchema,
  revision: revisionSchema,
  updatedAt: dateTimeSchema,
  publishedVersionNumber: revisionSchema,
  draft: hallLayoutDraftSchema,
}).refine(({ id, draft }) => id === draft.snapshot.id, {
  path: ['id'], message: 'Hall ID must match the draft snapshot ID',
});
export type ApiHallRecord = z.infer<typeof apiHallRecordSchema>;
export const apiDraftWriteSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  draft: hallLayoutDraftSchema,
  warningsAcknowledged: z.boolean().optional(),
});

export const apiPublishedVersionSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  versionId: idSchema,
  hallId: idSchema,
  versionNumber: z.number().int().positive(),
  publishedAt: dateTimeSchema,
  layout: hallLayoutDraftSchema,
});
export type ApiPublishedVersion = z.infer<typeof apiPublishedVersionSchema>;
export const apiPublishedVersionListSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  items: z.array(apiPublishedVersionSchema),
});
export const apiPublishResultSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  record: apiHallRecordSchema,
  published: apiPublishedVersionSchema,
});

export const apiSeatSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('seat'), seatId: idSchema }),
  z.strictObject({
    kind: z.literal('generalAdmission'),
    zoneId: idSchema,
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
]);
export type ApiSeatSelection = z.infer<typeof apiSeatSelectionSchema>;

export const apiHoldRequestSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  selection: z.array(apiSeatSelectionSchema).min(1),
  availabilityRevision: revisionSchema.optional(),
}).superRefine(({ selection }, context) => {
  const seen = new Set<string>();
  for (const [index, item] of selection.entries()) {
    const key = item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`;
    if (seen.has(key)) context.addIssue({
      code: 'custom', path: ['selection', index], message: 'Duplicate selection',
    });
    seen.add(key);
  }
});
export type ApiHoldRequest = z.infer<typeof apiHoldRequestSchema>;

export const apiHoldSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  id: idSchema,
  occurrenceId: idSchema,
  expiresAt: dateTimeSchema,
  selection: z.array(apiSeatSelectionSchema).min(1),
  total: apiMoneySchema,
  availabilityRevision: revisionSchema,
});
export type ApiHold = z.infer<typeof apiHoldSchema>;

export const apiSeatAvailabilitySchema = z.strictObject({
  apiVersion: apiVersionSchema,
  revision: revisionSchema,
  seats: z.record(idSchema, seatStatusSchema),
  zones: z.record(idSchema, z.strictObject({
    available: revisionSchema,
    maxPerOrder: z.number().int().positive().optional(),
  })).default({}),
});
export type ApiSeatAvailability = z.infer<typeof apiSeatAvailabilitySchema>;

export const apiSeatPriceSchema = apiMoneySchema.extend({
  category: z.string().min(1).optional(),
});
export const apiSeatPricesSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  seats: z.record(idSchema, apiSeatPriceSchema),
  zones: z.record(idSchema, apiSeatPriceSchema).default({}),
});
export type ApiSeatPrices = z.infer<typeof apiSeatPricesSchema>;

export const apiPublishedLayoutSchema = z.strictObject({
  hallName: z.string().min(1),
  snapshot: layoutSnapshotSchema,
  zoneBounds: hallLayoutDraftSchema.shape.zoneBounds.optional(),
}).refine(({ snapshot }) => snapshot.backgrounds.every((background) => background.source.kind !== 'pdf'), {
  path: ['snapshot', 'backgrounds'], message: 'Buyer payload must not contain private PDF backgrounds',
});

export const apiOccurrenceSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  id: idSchema,
  title: z.string().min(1),
  startsAt: dateTimeSchema,
  layoutVersionId: idSchema,
  layout: apiPublishedLayoutSchema,
  availability: apiSeatAvailabilitySchema,
  prices: apiSeatPricesSchema,
  ownHold: apiHoldSchema.nullable(),
});
export type ApiOccurrence = z.infer<typeof apiOccurrenceSchema>;
export const apiOccurrenceListSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  items: z.array(apiOccurrenceSchema),
});

export const apiOrderRequestSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  holdId: idSchema,
});

export const apiOrderSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  id: idSchema,
  occurrenceId: idSchema,
  holdId: idSchema,
  status: z.enum(['pending', 'confirmed', 'cancelled']),
  selection: z.array(apiSeatSelectionSchema).min(1),
  total: apiMoneySchema,
  createdAt: dateTimeSchema,
});
export type ApiOrder = z.infer<typeof apiOrderSchema>;

export const apiValidationResultSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  issues: z.array(z.strictObject({
    severity: z.enum(['error', 'warning']),
    code: z.string().min(1),
    message: z.string().min(1),
  })),
});
export type ApiValidationResult = z.infer<typeof apiValidationResultSchema>;

export const apiAssetUploadRequestSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  name: z.string().min(1),
  contentType: z.literal('application/pdf'),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ApiAssetUploadRequest = z.infer<typeof apiAssetUploadRequestSchema>;
export const apiAssetUploadIntentSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  assetId: idSchema,
  uploadUrl: z.url(),
  expiresAt: dateTimeSchema,
});
export type ApiAssetUploadIntent = z.infer<typeof apiAssetUploadIntentSchema>;
export const apiAssetSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  id: idSchema,
  name: apiAssetUploadRequestSchema.shape.name,
  contentType: apiAssetUploadRequestSchema.shape.contentType,
  sizeBytes: apiAssetUploadRequestSchema.shape.sizeBytes,
  sha256: apiAssetUploadRequestSchema.shape.sha256,
});
export type ApiAsset = z.infer<typeof apiAssetSchema>;

export const apiErrorSchema = z.strictObject({
  apiVersion: apiVersionSchema,
  code: z.enum([
    'validation_failed', 'unauthorized', 'forbidden', 'not_found',
    'revision_conflict', 'availability_conflict', 'idempotency_conflict',
    'hold_expired', 'rate_limited', 'service_unavailable',
    'pricing_catalog_conflict', 'layout_version_conflict',
    'invalid_pricing_assignment',
  ]),
  message: z.string().min(1),
  currentRevision: revisionSchema.optional(),
  retryAfterMs: revisionSchema.optional(),
  issues: z.array(z.strictObject({
    severity: z.enum(['error', 'warning']),
    code: z.string().min(1),
    message: z.string().min(1),
    targetId: idSchema.optional(),
  })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

import { z } from 'zod';
import {
  apiErrorSchema,
  apiDraftWriteSchema,
  apiHallListSchema,
  apiHallRecordSchema,
  apiHallSummarySchema,
  apiHoldRequestSchema,
  apiHoldSchema,
  apiMoneySchema,
  apiOccurrenceListSchema,
  apiOccurrenceSchema,
  apiOrderRequestSchema,
  apiOrderSchema,
  apiPublishedVersionListSchema,
  apiPublishedVersionSchema,
  apiPublishResultSchema,
  apiSeatAvailabilitySchema,
  apiSeatPricesSchema,
  apiValidationResultSchema,
  apiAssetUploadRequestSchema,
  apiAssetUploadIntentSchema,
  apiAssetSchema,
} from './contracts.js';
import {
  apiPricingAssignmentsSchema,
  apiPricingAssignmentsWriteSchema,
  apiPricingCatalogSchema,
} from './pricing.js';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({
  content: { 'application/json': { schema: ref(name) } },
});
const jsonExamples = (name: string, examples: Record<string, unknown>) => ({
  content: { 'application/json': { schema: ref(name), examples } },
});
const success = (name: string, status = '200') => ({
  [status]: { description: 'Success', ...json(name) },
});
const mutationErrors = {
  '400': { description: 'Invalid input', ...json('Error') },
  '401': { description: 'Authentication required', ...json('Error') },
  '403': { description: 'Not permitted in this tenant', ...json('Error') },
  '409': { description: 'Revision, availability, or idempotency conflict', ...json('Error') },
  '429': { description: 'Rate limited', ...json('Error') },
};
const readErrors = {
  '401': mutationErrors['401'],
  '403': mutationErrors['403'],
  '404': { description: 'Resource not found', ...json('Error') },
};
const id = { $ref: '#/components/parameters/Id' };
const key = { $ref: '#/components/parameters/IdempotencyKey' };
const match = { $ref: '#/components/parameters/IfMatch' };
const request = (name: string) => ({ required: true, ...json(name) });
const pricingAssignmentsExamples = {
  emptyAssignments: {
    summary: 'No segments are assigned yet',
    value: {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'concert-2026-10-28',
      layoutVersionId: 'hall-layout-v3', revision: 2, catalogRevision: 9,
      assignments: { seatSegments: {}, gaZoneSegments: {} },
    },
  },
  mixedSeatedZone: {
    summary: 'A seated zone with a manual VIP override',
    value: {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'concert-2026-10-28',
      layoutVersionId: 'hall-layout-v3', revision: 3, catalogRevision: 9,
      assignments: {
        seatSegments: { 'seat-parterre-1': 'segment-standard', 'seat-parterre-2': 'segment-vip' },
        gaZoneSegments: {},
      },
    },
  },
  generalAdmissionZone: {
    summary: 'A GA zone has one segment ID; capacity remains on the layout',
    value: {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'concert-2026-10-28',
      layoutVersionId: 'hall-layout-v3', revision: 4, catalogRevision: 9,
      assignments: { seatSegments: {}, gaZoneSegments: { 'zone-dance-floor': 'segment-standing' } },
    },
  },
} as const;
const pricingAssignmentWriteExamples = {
  emptyAssignments: {
    summary: 'Save an empty assignment map',
    value: {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'concert-2026-10-28',
      layoutVersionId: 'hall-layout-v3', catalogRevision: 9,
      assignments: { seatSegments: {}, gaZoneSegments: {} },
    },
  },
  mixedSeatedZone: {
    summary: 'Save a zone assignment with an explicit manual seat override',
    value: {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'concert-2026-10-28',
      layoutVersionId: 'hall-layout-v3', catalogRevision: 9,
      assignments: {
        seatSegments: { 'seat-parterre-1': 'segment-standard', 'seat-parterre-2': 'segment-vip' },
        gaZoneSegments: {},
      },
    },
  },
  generalAdmissionZone: {
    summary: 'Save a GA segment without changing layout capacity',
    value: {
      apiVersion: 'v1', schemaVersion: 1, occurrenceId: 'concert-2026-10-28',
      layoutVersionId: 'hall-layout-v3', catalogRevision: 9,
      assignments: { seatSegments: {}, gaZoneSegments: { 'zone-dance-floor': 'segment-standing' } },
    },
  },
} as const;
const pricingConflictExamples = {
  catalogChanged: {
    summary: 'The catalog revision no longer matches',
    value: { apiVersion: 'v1', code: 'pricing_catalog_conflict', message: 'Pricing catalog changed; reload and review it.' },
  },
  layoutChanged: {
    summary: 'Assignments target another published layout version',
    value: { apiVersion: 'v1', code: 'layout_version_conflict', message: 'Published layout version changed.' },
  },
  invalidTarget: {
    summary: 'A target is invalid for pricing',
    value: {
      apiVersion: 'v1', code: 'invalid_pricing_assignment',
      message: 'One or more assignments are invalid.',
      issues: [{ severity: 'error', code: 'not_ga_zone', message: 'Zone is not GA.', targetId: 'zone-parterre' }],
    },
  },
} as const;
const emptySuccess = { '204': { description: 'Completed without a response body' } };

/** The v1 wire contract. Generated schemas share the runtime Zod validators. */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Hall Platform API',
    version: '1.0.0',
    description:
      'Proposed backend contract. The backend is the authority for availability, minor-unit prices, hold ownership and expiry, idempotency, tenant access, and immutable published versions. A local demo is not a backend implementation.',
  },
  servers: [{ url: 'http://localhost:8080', description: 'Example backend URL; no server is bundled' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/v1/halls': {
      get: {
        operationId: 'listHalls', summary: 'List halls visible to the caller',
        responses: { ...success('HallList'), ...readErrors },
      },
      post: {
        operationId: 'createHall', summary: 'Create a hall and its first draft',
        parameters: [key], requestBody: request('DraftWrite'),
        responses: { ...success('HallRecord', '201'), ...mutationErrors },
      },
    },
    '/api/v1/halls/{id}': {
      get: {
        operationId: 'getHall', summary: 'Read a hall and editable draft',
        parameters: [id], responses: { ...success('HallRecord'), ...readErrors },
      },
      delete: {
        operationId: 'deleteHall', summary: 'Delete a hall after checking its revision',
        parameters: [id, match, key],
        responses: { ...emptySuccess, ...mutationErrors, ...readErrors },
      },
    },
    '/api/v1/layouts/{id}/draft': {
      get: {
        operationId: 'getLayoutDraft', summary: 'Read a layout draft',
        parameters: [id], responses: { ...success('HallRecord'), ...readErrors },
      },
      put: {
        operationId: 'saveLayoutDraft', summary: 'Replace a draft with optimistic concurrency',
        parameters: [id, match, key], requestBody: request('DraftWrite'),
        responses: { ...success('HallRecord'), ...mutationErrors },
      },
    },
    '/api/v1/layouts/{id}/validate': {
      post: {
        operationId: 'validateLayoutDraft', summary: 'Validate a draft before publication',
        parameters: [id], requestBody: request('DraftWrite'),
        responses: { ...success('ValidationResult'), ...mutationErrors },
      },
    },
    '/api/v1/layouts/{id}/publish': {
      post: {
        operationId: 'publishLayoutDraft',
        summary: 'Atomically save and publish an immutable version',
        parameters: [id, match, key], requestBody: request('DraftWrite'),
        responses: { ...success('PublishResult'), ...mutationErrors },
      },
    },
    '/api/v1/layouts/{id}/versions': {
      get: {
        operationId: 'listLayoutVersions', summary: 'List immutable published versions',
        parameters: [id], responses: { ...success('PublishedVersionList'), ...readErrors },
      },
    },
    '/api/v1/layout-versions/{id}': {
      get: {
        operationId: 'getLayoutVersion', summary: 'Read one immutable published version',
        parameters: [id], responses: { ...success('PublishedVersion'), ...readErrors },
      },
    },
    '/api/v1/assets/upload-intents': {
      post: {
        operationId: 'createAssetUploadIntent',
        summary: 'Request a scoped, expiring PDF upload URL',
        parameters: [key], requestBody: request('AssetUploadRequest'),
        responses: { ...success('AssetUploadIntent', '201'), ...mutationErrors },
      },
    },
    '/api/v1/assets/{id}/complete': {
      post: {
        operationId: 'completeAssetUpload', summary: 'Verify uploaded bytes and finalize an asset',
        parameters: [id, key], responses: { ...success('Asset'), ...mutationErrors },
      },
    },
    '/api/v1/assets/{id}': {
      get: {
        operationId: 'getAsset', summary: 'Read authorized asset metadata',
        parameters: [id], responses: { ...success('Asset'), ...readErrors },
      },
      delete: {
        operationId: 'deleteAsset', summary: 'Delete an unused asset',
        parameters: [id, key], responses: { ...emptySuccess, ...mutationErrors, ...readErrors },
      },
    },
    '/api/v1/occurrences': {
      get: {
        operationId: 'listOccurrences', summary: 'List buyer occurrences visible to the caller',
        responses: { ...success('OccurrenceList'), ...readErrors },
      },
    },
    '/api/v1/occurrences/{id}': {
      get: {
        operationId: 'getOccurrence', summary: 'Get an occurrence with current server availability and prices',
        parameters: [id], responses: { ...success('Occurrence'), ...readErrors },
      },
    },
    '/api/v1/occurrences/{id}/seat-map': {
      get: {
        operationId: 'getOccurrenceSeatMap', summary: 'Read the public published layout',
        parameters: [id], responses: { ...success('PublishedLayout'), ...readErrors },
      },
    },
    '/api/v1/occurrences/{id}/availability': {
      get: {
        operationId: 'getOccurrenceAvailability', summary: 'Read current seat and zone inventory',
        parameters: [id], responses: { ...success('Availability'), ...readErrors },
      },
    },
    '/api/v1/occurrences/{id}/prices': {
      get: {
        operationId: 'getOccurrencePrices', summary: 'Read server-authoritative minor-unit prices',
        parameters: [id], responses: { ...success('Prices'), ...readErrors },
      },
    },
    '/api/v1/occurrences/{id}/pricing-segments': {
      get: {
        operationId: 'getPricingSegments',
        summary: 'Read the managed pricing segment catalog for one occurrence',
        parameters: [id],
        responses: {
          '200': {
            description: 'Read-only pricing catalog for the selected occurrence',
            ...jsonExamples('PricingCatalog', {
              activeAndArchivedSegments: {
                summary: 'Stable IDs, active and archived segments, minor-unit prices',
                value: {
                  apiVersion: 'v1', occurrenceId: 'concert-2026-10-28', revision: 9,
                  items: [
                    { id: 'segment-standard', name: 'Стандарт', color: '#2b7b68', status: 'active', price: { amountMinor: 125000, currency: 'RUB' } },
                    { id: 'segment-vip', name: 'VIP', color: '#784fa3', status: 'active', price: { amountMinor: 250000, currency: 'RUB' } },
                    { id: 'segment-standing', name: 'Танцпол', color: '#bd8424', status: 'active', price: { amountMinor: 90000, currency: 'RUB' } },
                    { id: 'segment-retired', name: 'Старый тариф', color: '#7a838f', status: 'archived', price: { amountMinor: 0, currency: 'RUB' } },
                  ],
                },
              },
            }),
          },
          ...readErrors,
        },
      },
    },
    '/api/v1/occurrences/{id}/pricing-assignments': {
      get: {
        operationId: 'getPricingAssignments',
        summary: 'Read saved price assignments for an occurrence and published layout version',
        parameters: [id],
        responses: {
          '200': {
            description: 'Saved segment IDs for the occurrence and published layout version',
            ...jsonExamples('PricingAssignments', pricingAssignmentsExamples),
          },
          ...readErrors,
          '409': {
            description: 'The occurrence no longer uses the published layout referenced by the assignments',
            ...jsonExamples('Error', { layoutChanged: pricingConflictExamples.layoutChanged }),
          },
        },
      },
      put: {
        operationId: 'savePricingAssignments',
        summary: 'Atomically replace occurrence pricing assignments',
        description: 'The backend validates occurrence and published-layout context, active catalog segment IDs, target IDs and GA zone kinds, and the catalog currency. It replaces the full assignment maps atomically only when If-Match and Idempotency-Key are accepted. A seated zone is expanded to explicit seat IDs by the client; GA capacity remains in the published layout. HTTP 400 reports invalid assignments, HTTP 409 reports revision/catalog/layout/idempotency conflicts, and HTTP 503 reports a possibly unknown mutation outcome that must be retried with the same body and key.',
        parameters: [id, match, key],
        requestBody: {
          required: true,
          ...jsonExamples('PricingAssignmentsWrite', pricingAssignmentWriteExamples),
        },
        responses: {
          '200': {
            description: 'The server-accepted assignments and new revision',
            ...jsonExamples('PricingAssignments', pricingAssignmentsExamples),
          },
          '400': {
            description: 'Invalid assignment or request',
            ...jsonExamples('Error', { invalidTarget: pricingConflictExamples.invalidTarget }),
          },
          '401': { description: 'Authentication required', ...json('Error') },
          '403': { description: 'Not permitted in this tenant', ...json('Error') },
          '404': { description: 'Occurrence not found', ...json('Error') },
          '409': {
            description: 'Revision, catalog, layout, or idempotency conflict',
            ...jsonExamples('Error', pricingConflictExamples),
          },
          '429': { description: 'Rate limited', ...json('Error') },
          '503': { description: 'Mutation outcome may be unknown; retry the exact request with the same Idempotency-Key', ...json('Error') },
        },
      },
    },
    '/api/v1/occurrences/{id}/holds': {
      post: {
        operationId: 'createHold',
        summary: 'Atomically reserve inventory with server-priced total and expiry',
        description: 'The backend checks ownership, published layout, availability revision and inventory in one transaction. A repeated Idempotency-Key returns the same hold.',
        parameters: [id, key], requestBody: request('HoldRequest'),
        responses: { ...success('Hold', '201'), ...mutationErrors },
      },
    },
    '/api/v1/holds/{id}': {
      get: {
        operationId: 'getHold', summary: 'Read an owned, active hold',
        parameters: [id], responses: { ...success('Hold'), ...readErrors },
      },
      delete: {
        operationId: 'cancelHold', summary: 'Release an owned hold',
        parameters: [id, key], responses: { ...emptySuccess, ...mutationErrors, ...readErrors },
      },
    },
    '/api/v1/orders': {
      post: {
        operationId: 'createOrder', summary: 'Create an order from an owned, unexpired hold',
        parameters: [key], requestBody: request('OrderRequest'),
        responses: { ...success('Order', '201'), ...mutationErrors },
      },
    },
    '/api/v1/orders/{id}': {
      get: {
        operationId: 'getOrder', summary: 'Read an owned order',
        parameters: [id], responses: { ...success('Order'), ...readErrors },
      },
    },
    '/api/v1/orders/{id}/checkout': {
      post: {
        operationId: 'checkoutOrder',
        summary: 'Confirm an order after server-side pricing and checkout checks',
        parameters: [id, key], requestBody: request('VersionOnly'),
        responses: { ...success('Order'), ...mutationErrors },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    parameters: {
      Id: { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
      IfMatch: {
        name: 'If-Match', in: 'header', required: true,
        description: 'Quoted decimal revision, for example "4".',
        schema: { type: 'string', pattern: '^"[0-9]+"$' },
      },
      IdempotencyKey: {
        name: 'Idempotency-Key', in: 'header', required: true,
        description: 'Stable for one logical mutation; backend scopes it to caller and route.',
        schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' },
      },
    },
    schemas: {
      Money: z.toJSONSchema(apiMoneySchema),
      HallSummary: z.toJSONSchema(apiHallSummarySchema),
      HallList: z.toJSONSchema(apiHallListSchema),
      HallRecord: z.toJSONSchema(apiHallRecordSchema),
      PublishedVersion: z.toJSONSchema(apiPublishedVersionSchema),
      PublishedVersionList: z.toJSONSchema(apiPublishedVersionListSchema),
      PublishResult: z.toJSONSchema(apiPublishResultSchema),
      Availability: z.toJSONSchema(apiSeatAvailabilitySchema),
      Prices: z.toJSONSchema(apiSeatPricesSchema),
      PricingCatalog: z.toJSONSchema(apiPricingCatalogSchema),
      PricingAssignments: z.toJSONSchema(apiPricingAssignmentsSchema),
      PricingAssignmentsWrite: z.toJSONSchema(apiPricingAssignmentsWriteSchema),
      Occurrence: z.toJSONSchema(apiOccurrenceSchema),
      OccurrenceList: z.toJSONSchema(apiOccurrenceListSchema),
      HoldRequest: z.toJSONSchema(apiHoldRequestSchema),
      Hold: z.toJSONSchema(apiHoldSchema),
      OrderRequest: z.toJSONSchema(apiOrderRequestSchema),
      Order: z.toJSONSchema(apiOrderSchema),
      Error: z.toJSONSchema(apiErrorSchema),
      DraftWrite: z.toJSONSchema(apiDraftWriteSchema),
      VersionOnly: {
        type: 'object', additionalProperties: false,
        required: ['apiVersion'], properties: { apiVersion: { const: 'v1' } },
      },
      PublishedLayout: z.toJSONSchema(apiOccurrenceSchema.shape.layout),
      ValidationResult: z.toJSONSchema(apiValidationResultSchema),
      AssetUploadRequest: z.toJSONSchema(apiAssetUploadRequestSchema),
      AssetUploadIntent: z.toJSONSchema(apiAssetUploadIntentSchema),
      Asset: z.toJSONSchema(apiAssetSchema),
    },
  },
} as const;

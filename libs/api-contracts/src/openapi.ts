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
import {
  buyerCheckoutRequestSchema,
  buyerCheckoutResultSchema,
  buyerAvailabilityChangesSchema,
  buyerAvailabilitySchema,
  buyerContactWriteSchema,
  buyerErrorSchema,
  buyerHoldRequestSchema,
  buyerHoldSchema,
  buyerOccurrenceContextSchema,
  buyerOccurrenceListSchema,
  buyerOrderRequestSchema,
  buyerOrderSchema,
  buyerOtpChallengeSchema,
  buyerOtpStartRequestSchema,
  buyerOtpVerifyRequestSchema,
  buyerPaymentAttemptSchema,
  buyerPublicLayoutSchema,
  buyerPricesSchema,
  buyerQuoteRequestSchema,
  buyerQuoteSchema,
  buyerSessionContactSchema,
  buyerSessionCreateRequestSchema,
  buyerSessionCreateResultSchema,
  buyerSessionResumeSchema,
  buyerTicketListSchema,
} from './buyer.js';

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
const buyerBackendRules = 'The backend owns durable purchase state for buyer sessions, contact verification, holds, orders, quotes, payment attempts, tickets, and idempotency results. Inventory and purchase-state changes are committed by the backend. Seat allocations and general-admission capacity checks are atomic, expired holds cannot be confirmed, provider callbacks are idempotent, and checkout reuses the payment attempt for the same logical operation. Physical tables and indexes remain backend implementation details. An HTTP timeout or AbortSignal abort does not cancel a mutation already accepted by the server; after an uncertain outcome, retry the exact body with the same Idempotency-Key and resume the session.';
const buyerOperationDescription = (detail: string) => `${detail}\n\n${buyerBackendRules}`;
const buyerErrorExample = (code: string, message: string, extras: Record<string, unknown> = {}) => ({
  apiVersion: 'v2', code, message, ...extras,
});
const buyerErrorResponse = (
  description: string,
  exampleName: string,
  summary: string,
  value: Record<string, unknown>,
) => ({
  description,
  ...jsonExamples('BuyerError', { [exampleName]: { summary, value } }),
});
const buyerSuccessResponse = (
  schema: string,
  status: string,
  exampleName: string,
  summary: string,
  value: unknown,
) => ({
  [status]: {
    description: summary,
    ...jsonExamples(schema, { [exampleName]: { summary, value } }),
  },
});
const buyerRequest = (schema: string, examples: Record<string, unknown>) => ({
  required: true,
  ...jsonExamples(schema, examples),
});
const expiredSessionError = buyerErrorExample('session_expired', 'Buyer session has expired. Start an approved session recovery flow.');
const unauthenticatedBuyerError = buyerErrorExample('unauthorized', 'A valid buyer-session credential is required.');
const forbiddenBuyerError = buyerErrorExample('forbidden', 'This resource is not owned by the selected purchase session.');
const missingBuyerResourceError = buyerErrorExample('not_found', 'The requested buyer resource was not found.');
const revisionConflictError = buyerErrorExample('revision_conflict', 'The buyer state changed. Read current state before retrying.', { currentRevision: 8 });
const idempotencyConflictError = buyerErrorExample('idempotency_conflict', 'This Idempotency-Key was already used with a different request body.');
const rateLimitedBuyerError = buyerErrorExample('rate_limited', 'Too many requests. Retry after the stated delay.', { retryAfterMs: 30000 });
const unavailableBuyerError = buyerErrorExample('service_unavailable', 'The service is temporarily unavailable; the outcome of a submitted mutation may be unknown.', { retryAfterMs: 5000 });

const buyerOccurrenceSummaryExample = {
  occurrenceId: 'concert-2026-10-28-evening', eventId: 'concert-2026-10-28',
  title: 'Autumn Chamber Orchestra', startsAt: '2026-10-28T19:00:00+03:00', timeZone: 'Europe/Moscow',
  venue: { name: 'North Hall', city: 'Krasnoyarsk', address: '1 Theatre Square' },
  poster: { url: 'https://example.test/posters/autumn-orchestra.jpg', alt: 'Autumn Chamber Orchestra' },
  salesStatus: 'open', currency: 'RUB', capabilities: { seats: true, generalAdmission: true },
};
const buyerHoldExample = {
  apiVersion: 'v2', id: 'hold-72', ownerSessionId: 'purchase-session-4f', occurrenceId: 'concert-2026-10-28-evening',
  layoutVersionId: 'layout-v5', revision: 6, expiresAt: '2026-10-28T16:10:00Z', serverTime: '2026-10-28T16:00:00Z',
  selection: [{ kind: 'seat', seatId: 'seat-a-12' }],
  lineItems: [{ label: 'A12', quantity: 1, unitPriceMinor: 125000, totalMinor: 125000 }],
  totalMinor: 125000, currency: 'RUB', availabilityRevision: 44, status: 'active',
};
const buyerExpiredHoldExample = {
  ...buyerHoldExample, status: 'expired', serverTime: '2026-10-28T16:12:00Z',
};
const buyerOrderExample = {
  apiVersion: 'v2', id: 'order-88', occurrenceId: 'concert-2026-10-28-evening', layoutVersionId: 'layout-v5',
  revision: 9, holdId: 'hold-72', quoteId: 'quote-31', contactRevision: 3,
  selection: [{ kind: 'seat', seatId: 'seat-a-12' }],
  lines: [{ label: 'A12', quantity: 1, unitPriceMinor: 125000, totalMinor: 125000 }],
  currency: 'RUB', status: 'confirmed', paymentStatus: 'paid', ticketDeliveryStatus: 'pending',
  createdAt: '2026-10-28T15:58:00Z',
};
const buyerQuoteExample = {
  apiVersion: 'v2', quoteId: 'quote-31', orderId: 'order-88', revision: 2,
  expiresAt: '2026-10-28T16:05:00Z', currency: 'RUB',
  lines: [{ label: 'A12', quantity: 1, unitPriceMinor: 125000, totalMinor: 125000 }],
  ticketsSubtotalMinor: 125000, discountMinor: 0, serviceFeeMinor: 5000, commissionMinor: 2500,
  totalMinor: 132500, promo: { status: 'none' },
};
const buyerPaidCheckoutExample = {
  apiVersion: 'v2',
  order: buyerOrderExample,
  paymentAttempt: { apiVersion: 'v2', id: 'payment-52', orderId: 'order-88', status: 'succeeded', action: { kind: 'none' } },
};
const buyerPublicLayoutExample = {
  apiVersion: 'v2', hallName: 'North Hall',
  snapshot: {
    id: 'snapshot-v5', layoutVersionId: 'layout-v5', floors: [], zones: [], rows: [], seats: [],
    tables: [], backgrounds: [], decorations: [],
  },
};
const buyerAvailabilityExample = {
  apiVersion: 'v2', occurrenceId: 'concert-2026-10-28-evening', layoutVersionId: 'layout-v5',
  revision: 44, serverTime: '2026-10-28T16:00:00Z',
  seats: { 'seat-a-12': 'available', 'seat-a-13': 'held' },
  zones: { 'zone-floor': { available: 37, maxPerOrder: 6 } },
};
const buyerAvailabilityChangesExample = {
  apiVersion: 'v2', occurrenceId: 'concert-2026-10-28-evening', layoutVersionId: 'layout-v5',
  sinceRevision: 44, currentRevision: 46, serverTime: '2026-10-28T16:01:00Z', resyncRequired: false,
  changes: [
    { baseRevision: 44, revision: 45, seats: { 'seat-a-12': 'held' } },
    { baseRevision: 45, revision: 46, zones: { 'zone-floor': { available: 36, maxPerOrder: 6 } } },
  ],
};
const buyerAvailabilityResyncExample = {
  apiVersion: 'v2', occurrenceId: 'concert-2026-10-28-evening', layoutVersionId: 'layout-v5',
  sinceRevision: 12, currentRevision: 46, serverTime: '2026-10-28T16:01:00Z', resyncRequired: true, changes: [],
};
const buyerPricesExample = {
  apiVersion: 'v2', occurrenceId: 'concert-2026-10-28-evening', layoutVersionId: 'layout-v5',
  pricingRevision: 12, currency: 'RUB', seats: { 'seat-a-12': { amountMinor: 125000, category: 'standard' } },
  zones: { 'zone-floor': { amountMinor: 90000, category: 'standing' } },
};
const buyerErrorResponses = {
  badRequest: buyerErrorResponse('The request is malformed or fails field validation.', 'validationFailed', 'Malformed request',
    buyerErrorExample('validation_failed', 'The request contains malformed or invalid input.')),
  unauthorized: buyerErrorResponse('The buyer-session credential is missing, invalid, or expired.', 'unauthorized', 'Buyer session required', unauthenticatedBuyerError),
  forbidden: buyerErrorResponse('The authenticated buyer is not permitted to access this resource or tenant.', 'forbidden', 'Resource is not owned by this session', forbiddenBuyerError),
  notFound: buyerErrorResponse('The requested occurrence, session resource, hold, challenge, quote, or order does not exist or is not visible.', 'notFound', 'Buyer resource not found', missingBuyerResourceError),
  rateLimited: {
    ...buyerErrorResponse('Too many requests. The BuyerError.retryAfterMs field states the minimum delay before retrying.', 'rateLimited', 'Retry after the supplied delay', rateLimitedBuyerError),
    headers: { 'Retry-After': { description: 'Minimum wait before retry, in seconds; the body also provides retryAfterMs.', schema: { type: 'integer', minimum: 0 } } },
  },
  unavailable: {
    ...buyerErrorResponse('The service is temporarily unavailable. For mutations, the server may have committed the request; query current state and retry the exact body with the same Idempotency-Key.', 'serviceUnavailable', 'Mutation outcome may be unknown', unavailableBuyerError),
    headers: { 'Retry-After': { description: 'Optional minimum wait before retry, in seconds.', schema: { type: 'integer', minimum: 0 } } },
  },
};
const buyerErrorsByStatus = {
  '400': buyerErrorResponses.badRequest,
  '401': buyerErrorResponses.unauthorized,
  '403': buyerErrorResponses.forbidden,
  '404': buyerErrorResponses.notFound,
  '409': { description: 'The supplied revision is stale or the Idempotency-Key conflicts with a prior request.' },
  '410': { description: 'The selected buyer session, hold, quote, or verification challenge has expired.' },
  '422': { description: 'The request is well formed but the current purchase state cannot accept it.' },
  '429': buyerErrorResponses.rateLimited,
  '503': buyerErrorResponses.unavailable,
} as const;
const buyerErrorSamples = {
  revisionConflict: { summary: 'Buyer state changed', value: revisionConflictError },
  idempotencyConflict: { summary: 'Idempotency key reused with another request', value: idempotencyConflictError },
  priceChanged: { summary: 'The authoritative price changed', value: buyerErrorExample('price_changed', 'Expected pricingRevision 12 is stale; the current pricing revision is 13. Refresh prices and confirm the current amount.', { currentRevision: 13 }) },
  layoutChanged: { summary: 'The occurrence now uses another layout version', value: buyerErrorExample('layout_version_conflict', 'The layout version changed; refresh the public layout and selection.') },
  availabilityConflict: { summary: 'Inventory changed before the mutation', value: buyerErrorExample('availability_conflict', 'The selected inventory is no longer available.', { currentRevision: 45 }) },
  sessionExpired: { summary: 'Buyer session expired', value: expiredSessionError },
  holdExpired: { summary: 'Hold expired before order creation', value: buyerErrorExample('hold_expired', 'The hold expired before an order could be created.') },
  quoteExpired: { summary: 'Quote expired before checkout', value: buyerErrorExample('quote_expired', 'The quote expired before checkout.') },
  codeExpired: { summary: 'Email code expired', value: buyerErrorExample('code_expired', 'The email verification code expired.') },
  holdConverted: { summary: 'Hold converted while cancellation was in flight', value: buyerErrorExample('revision_conflict', 'The hold was converted to an order before cancellation committed. Resume the purchase session to retrieve the order.', { currentRevision: 7 }) },
  verificationRequired: { summary: 'Email verification required', value: buyerErrorExample('verification_required', 'Verify the contact email before checkout.', { fieldErrors: [{ path: ['contact', 'email'], message: 'Verify this email before checkout.' }] }) },
  invalidCode: { summary: 'Email code does not match', value: buyerErrorExample('invalid_code', 'The code does not match the active challenge.', { fieldErrors: [{ path: ['code'], message: 'Enter the code sent for the active challenge.' }] }) },
  invalidPromo: { summary: 'Promotion cannot be applied', value: buyerErrorExample('invalid_promo', 'The promotion code is invalid or no longer active.', { fieldErrors: [{ path: ['promoCode'], message: 'This promotion cannot be applied.' }] }) },
  salesClosed: { summary: 'Sales are closed', value: buyerErrorExample('sales_closed', 'Sales are closed for this occurrence.') },
  paymentFailed: { summary: 'Payment could not be started', value: buyerErrorExample('payment_failed', 'The payment provider could not start this payment attempt.') },
  serviceUnavailableRead: { summary: 'Temporary read failure', value: buyerErrorExample('service_unavailable', 'The read could not be completed. Retry the read request after the stated delay.', { retryAfterMs: 5000 }) },
} as const;
type BuyerErrorStatus = keyof typeof buyerErrorsByStatus;
type BuyerErrorVariant = Partial<Record<'409' | '410' | '422' | '503', readonly (keyof typeof buyerErrorSamples)[]>>;
const buyerErrorVariantResponse = (status: '409' | '410' | '422' | '503', samples: readonly (keyof typeof buyerErrorSamples)[]) => ({
  ...buyerErrorsByStatus[status],
  description: status === '409'
    ? samples.includes('holdConverted')
      ? 'Cancellation raced with order conversion. The hold was not cancelled; resume the purchase session to retrieve the order. A stale If-Match revision also returns currentRevision, and a key conflict requires a new key for a different logical request.'
      : samples.includes('revisionConflict')
      ? 'The supplied revision is stale or the Idempotency-Key conflicts with a prior request. Read current state, compare currentRevision, and reconcile before retrying a revision conflict; a key conflict requires a new key for the new logical request.'
      : samples.some((sample) => ['availabilityConflict', 'priceChanged', 'layoutChanged'].includes(sample))
        ? 'Availability, layout, price, or idempotency state changed. Refresh the current occurrence context before retrying; a key conflict requires a new key for a different logical request.'
        : 'The Idempotency-Key was already used with a different request body. Use a new key for a different logical request.'
    : status === '503' && samples.includes('serviceUnavailableRead')
      ? 'Temporary service failure for this read request. Retry the read request after Retry-After.'
      : buyerErrorsByStatus[status].description,
  ...jsonExamples('BuyerError', Object.fromEntries(samples.map((sample) => [sample, buyerErrorSamples[sample]]))),
});
const buyerErrors = (...args: (BuyerErrorStatus | BuyerErrorVariant)[]) => {
  const variants = args.find((arg): arg is BuyerErrorVariant => typeof arg === 'object');
  const statuses = args.filter((arg): arg is BuyerErrorStatus => typeof arg === 'string');
  const responses: Record<string, unknown> = Object.fromEntries(statuses.map((status) => [status, buyerErrorsByStatus[status]]));
  (['409', '410', '422', '503'] as const).forEach((status) => {
    if (variants?.[status]) responses[status] = buyerErrorVariantResponse(status, variants[status]);
  });
  return responses;
};
const id = { $ref: '#/components/parameters/Id' };
const key = { $ref: '#/components/parameters/IdempotencyKey' };
const match = { $ref: '#/components/parameters/IfMatch' };
const purchaseSession = { $ref: '#/components/parameters/PurchaseSessionId' };
const buyerSessionSecurity = [{ buyerSessionAuth: [] }];
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
      'Proposed backend contract for agreement; it is not a claim that a backend exists. The backend owns durable persistence for immutable published layout versions and occurrence mappings, pricing assignments and revisions, inventory and capacity, buyer sessions and contact verification, holds and expiry, order-line snapshots, quote breakdowns, payment attempts, tickets, and idempotency results. Server transactions must prevent a seat from being sold twice, keep general-admission capacity nonnegative, reject confirmation of expired holds, make provider callbacks idempotent, and reuse payment attempts on checkout retry. Public projections are built server-side; draft editor assets remain in admin storage. Physical tables and indexes are intentionally unspecified. Open backend/native decisions: guest mode, session TTL, token refresh, redirect/deep-link allowlist, OTP provider, fees and discounts, payment provider, ticket issuance, session restoration, payment inventory lease, and handling of late provider callbacks after expiry.',
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
    '/api/v2/buyer/events/{eventId}/occurrences': {
      get: {
        operationId: 'listBuyerOccurrences', summary: 'List occurrences for an event',
        description: buyerOperationDescription('Returns lightweight public occurrence summaries for event date/time selection. Use the optional cursor to continue; this public endpoint does not require a buyer session.'),
        security: [],
        parameters: [
          { name: 'eventId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'cursor', in: 'query', required: false, schema: { type: 'string', minLength: 1 } },
        ],
        responses: {
          ...buyerSuccessResponse('BuyerOccurrenceList', '200', 'occurrences', 'One page of public event occurrences', {
            apiVersion: 'v2', items: [buyerOccurrenceSummaryExample], pagination: { nextCursor: 'occurrence-page-2', hasMore: true },
          }),
          ...buyerErrors('429', '503', { '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/occurrences/{id}/context': {
      get: {
        operationId: 'getBuyerOccurrenceContext', summary: 'Read the current buyer context for an occurrence',
        description: buyerOperationDescription('Returns public occurrence metadata together with this purchase session’s own active hold and current capability flags. The server verifies the session selector and owner before returning private session state.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id],
        responses: {
          ...buyerSuccessResponse('BuyerOccurrenceContext', '200', 'occurrenceContext', 'Occurrence context with no active hold', {
            apiVersion: 'v2', summary: buyerOccurrenceSummaryExample, layoutVersionId: 'layout-v5',
            availabilityRevision: 44, pricingRevision: 12, serverTime: '2026-10-28T16:00:00Z', ownHold: null,
            capabilities: { promoCode: true, emailVerification: true, paymentMode: 'redirect' },
          }),
          ...buyerErrors('401', '403', '404', '410', '429', '503', { '410': ['sessionExpired'], '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/occurrences/{id}/seat-map': {
      get: {
        operationId: 'getBuyerPublicLayout',
        summary: 'Read the public layout without editor backgrounds or assets',
        description: buyerOperationDescription('Returns immutable public geometry for the occurrence layout version. The public projection contains no editor backgrounds, PDF assets, images, or local blobs.'),
        security: [],
        parameters: [id],
        responses: {
          ...buyerSuccessResponse('BuyerPublicLayout', '200', 'publicLayout', 'Public projection of the selected layout version', buyerPublicLayoutExample),
          ...buyerErrors('404', '429', '503', { '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/occurrences/{id}/availability': {
      get: {
        operationId: 'getBuyerAvailability', summary: 'Read current occurrence inventory',
        description: buyerOperationDescription('Returns an authoritative availability snapshot stamped with occurrence, immutable layout version, monotonically increasing availability revision, and server time. This public read does not reveal buyer-owned hold data.'),
        security: [], parameters: [id],
        responses: {
          ...buyerSuccessResponse('BuyerAvailability', '200', 'availabilitySnapshot', 'Current seats and general-admission capacity', buyerAvailabilityExample),
          ...buyerErrors('404', '429', '503', { '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/occurrences/{id}/availability-changes': {
      get: {
        operationId: 'getBuyerAvailabilityChanges', summary: 'Read sequential availability changes',
        description: buyerOperationDescription('Returns sequential deltas after sinceRevision. Each delta baseRevision must equal the prior revision; when the retained history cannot bridge the requested revision, resyncRequired is true and changes is empty so the client fetches a new snapshot.'),
        security: [],
        parameters: [id, { name: 'sinceRevision', in: 'query', required: true, schema: { type: 'integer', minimum: 0 } }],
        responses: {
          '200': {
            description: 'Contiguous changes or an explicit resync request',
            ...jsonExamples('BuyerAvailabilityChanges', {
              contiguousChanges: { summary: 'Two sequential inventory deltas', value: buyerAvailabilityChangesExample },
              resyncRequired: { summary: 'History is unavailable; fetch a fresh snapshot', value: buyerAvailabilityResyncExample },
            }),
          },
          ...buyerErrors('400', '404', '429', '503', { '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/occurrences/{id}/prices': {
      get: {
        operationId: 'getBuyerPrices', summary: 'Read authoritative occurrence prices',
        description: buyerOperationDescription('Returns server-owned seat and general-admission prices in integer minor units, with occurrence/layout context, pricing revision, and ISO currency.'),
        security: [], parameters: [id],
        responses: {
          ...buyerSuccessResponse('BuyerPrices', '200', 'prices', 'Seat and GA prices at one pricing revision', buyerPricesExample),
          ...buyerErrors('404', '429', '503', { '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/occurrences/{id}/holds': {
      post: {
        operationId: 'createBuyerHold',
        summary: 'Create an owned hold from current availability',
        description: buyerOperationDescription('The server verifies the expected occurrence layoutVersionId, availabilityRevision, and pricingRevision before reserving inventory. A stale price revision returns HTTP 409 with code price_changed; refresh current prices and confirm the amount before retrying. It validates seat and general-admission availability, returns authoritative line items, total, and expiry, and commits inventory allocation and hold state atomically.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id, key],
        requestBody: buyerRequest('BuyerHoldRequest', {
          seatedSelection: { summary: 'Reserve a specific seat at expected layout, availability, and pricing revisions', value: { apiVersion: 'v2', layoutVersionId: 'layout-v5', availabilityRevision: 44, pricingRevision: 12, selection: [{ kind: 'seat', seatId: 'seat-a-12' }] } },
          generalAdmissionSelection: { summary: 'Reserve two places from a GA zone at expected revisions', value: { apiVersion: 'v2', layoutVersionId: 'layout-v5', availabilityRevision: 44, pricingRevision: 12, selection: [{ kind: 'generalAdmission', zoneId: 'zone-floor', quantity: 2 }] } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerHold', '201', 'activeHold', 'The server-priced inventory hold and expiry', buyerHoldExample),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '422', '429', '503', {
            '409': ['availabilityConflict', 'priceChanged', 'layoutChanged', 'idempotencyConflict'],
            '410': ['sessionExpired'], '422': ['salesClosed'],
          }),
        },
      },
    },
    '/api/v2/buyer/holds/{id}': {
      get: {
        operationId: 'getBuyerHold', summary: 'Read an owned hold and its expiry',
        description: buyerOperationDescription('Returns the hold owned by this purchase session, including current status, authoritative totals, selection, and expiry. Expired holds remain readable for recovery but cannot be converted into orders.'),
        security: buyerSessionSecurity, parameters: [purchaseSession, id],
        responses: {
          '200': {
            description: 'Owned hold, including expired holds retained for recovery',
            ...jsonExamples('BuyerHold', {
              activeHold: { summary: 'Owned inventory reserved until expiresAt', value: buyerHoldExample },
              expiredHold: { summary: 'Expired hold retained for recovery', value: buyerExpiredHoldExample },
            }),
          },
          ...buyerErrors('401', '403', '404', '429', '503', { '503': ['serviceUnavailableRead'] }),
        },
      },
      delete: {
        operationId: 'cancelBuyerHold',
        summary: 'Cancel an owned hold and release its inventory',
        description: buyerOperationDescription('Requires If-Match with the expected hold revision returned by GET /api/v2/buyer/holds/{id}. Releases this purchase session’s hold. Replaying the same Idempotency-Key and request returns the original response. A new cancellation request for an already cancelled or expired hold is a no-op and returns 204 when it supplies that hold’s latest revision. If order conversion races with cancellation and conversion wins, the server returns 409 without cancelling the converted hold; resume the purchase session to retrieve the order.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id, match, key],
        responses: {
          '204': { description: 'Hold released or already cancelled/expired at the supplied latest revision. Same-key retries replay this response; there is no response body.' },
          ...buyerErrors('401', '403', '404', '409', '429', '503', { '409': ['revisionConflict', 'holdConverted', 'idempotencyConflict'] }),
        },
      },
    },
    '/api/v2/buyer/sessions': {
      post: {
        operationId: 'createBuyerSession',
        summary: 'Create a buyer purchase session or exchange a host bootstrap credential',
        description: buyerOperationDescription('Creates a guest buyer session scoped to the occurrenceId in the request or exchanges a one-time host bootstrap credential. Each widget instance gets its own purchase session and must not share its purchaseSessionId with another widget instance. Returns a non-secret purchaseSessionId selector separately from the buyer-session credential, plus its expiry. Credential transport and storage must use the approved first-party or host mechanism; this contract does not prescribe a refresh or cookie flow.'),
        security: [],
        parameters: [key],
        requestBody: buyerRequest('BuyerSessionCreateRequest', {
          guestSession: { summary: 'Create a guest session for an occurrence', value: { apiVersion: 'v2', occurrenceId: 'concert-2026-10-28-evening' } },
          hostBootstrap: { summary: 'Exchange a one-time host bootstrap credential', value: { apiVersion: 'v2', occurrenceId: 'concert-2026-10-28-evening', hostBootstrapCredential: 'one-time-host-bootstrap-demo' } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerSessionCreateResult', '201', 'createdSession', 'Selector and credential are separate values', {
            apiVersion: 'v2', purchaseSessionId: 'purchase-session-4f', sessionCredential: 'demo-buyer-session-credential', expiresAt: '2026-10-28T20:00:00Z',
          }),
          ...buyerErrors('400', '401', '404', '409', '429', '503', { '409': ['idempotencyConflict'] }),
        },
      },
    },
    '/api/v2/buyer/sessions/current/resume': {
      get: {
        operationId: 'resumeBuyerSession',
        summary: 'Resume the purchase session and return its current order',
        description: buyerOperationDescription('Returns contacts and verification status, this session’s hold, active order, and payment attempt so reload or redirect return can restore state without creating duplicate orders or payments.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession],
        responses: {
          ...buyerSuccessResponse('BuyerSessionResume', '200', 'resumedSession', 'Current session state with an available hold and no order yet', {
            apiVersion: 'v2', purchaseSessionId: 'purchase-session-4f', occurrenceId: 'concert-2026-10-28-evening',
            contact: { firstName: 'Alex', lastName: 'Buyer', phone: '+7 900 123-45-67', email: 'alex@example.test' }, contactRevision: 3,
            emailVerification: { status: 'unverified', verifiedEmail: null }, ownHold: buyerHoldExample,
            activeOrder: null, activePaymentAttempt: null, serverTime: '2026-10-28T16:00:00Z',
          }),
          ...buyerErrors('401', '403', '404', '410', '429', '503', { '410': ['sessionExpired'], '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/sessions/current/contact': {
      put: {
        operationId: 'saveBuyerContact',
        summary: 'Save contact details in the buyer session',
        description: buyerOperationDescription('Requires the contactRevision from the current session. On HTTP 409, resume the session, compare currentRevision, and retry with the refreshed contact revision. A changed email resets verification for the new address.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, key],
        requestBody: buyerRequest('BuyerContactWrite', {
          contact: { summary: 'Save contact details against the current contact revision', value: { apiVersion: 'v2', contactRevision: 3, contact: { firstName: 'Alex', lastName: 'Buyer', phone: '+7 900 123-45-67', email: 'alex@example.test' } } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerSessionContact', '200', 'savedContact', 'Saved contact with current revision and verification state', {
            apiVersion: 'v2', contact: { firstName: 'Alex', lastName: 'Buyer', phone: '+7 900 123-45-67', email: 'alex@example.test' },
            contactRevision: 4, emailVerification: { status: 'unverified', verifiedEmail: null },
          }),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '429', '503', {
            '409': ['revisionConflict', 'idempotencyConflict'], '410': ['sessionExpired'],
          }),
        },
      },
    },
    '/api/v2/buyer/sessions/current/email-challenges': {
      post: {
        operationId: 'startBuyerEmailVerification',
        summary: 'Send a one-time email verification code',
        description: buyerOperationDescription('Starts an email challenge for the current contact email. The response contains challenge metadata only and never contains the code; server resend limits are reflected in Retry-After and BuyerError.retryAfterMs.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, key],
        requestBody: buyerRequest('BuyerOtpStartRequest', {
          emailChallenge: { summary: 'Request a code for the contact address', value: { apiVersion: 'v2', email: 'alex@example.test' } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerOtpChallenge', '201', 'challengeCreated', 'Challenge metadata without the code', {
            apiVersion: 'v2', challengeId: 'email-challenge-17', destinationMasked: 'a***@example.test', codeLength: 6,
            expiresAt: '2026-10-28T16:05:00Z', resendAvailableAt: '2026-10-28T16:01:00Z', attemptsRemaining: 5,
          }),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '429', '503', {
            '409': ['idempotencyConflict'], '410': ['sessionExpired'],
          }),
        },
      },
    },
    '/api/v2/buyer/email-challenges/{id}/verify': {
      post: {
        operationId: 'confirmBuyerEmailVerification',
        summary: 'Verify a buyer email with a one-time code',
        description: buyerOperationDescription('Consumes a one-time code only when it belongs to the active challenge for the current session contact email. Repeated submissions with the same Idempotency-Key return the saved result.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id, key],
        requestBody: buyerRequest('BuyerOtpVerifyRequest', {
          verificationCode: { summary: 'Submit the code delivered out of band', value: { apiVersion: 'v2', code: '482951' } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerSessionContact', '200', 'verifiedContact', 'Current contact and email verification state', {
            apiVersion: 'v2', contact: { firstName: 'Alex', lastName: 'Buyer', phone: '+7 900 123-45-67', email: 'alex@example.test' },
            contactRevision: 4, emailVerification: { status: 'verified', verifiedEmail: 'alex@example.test' },
          }),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '422', '429', '503', {
            '409': ['idempotencyConflict'], '410': ['sessionExpired', 'codeExpired'], '422': ['invalidCode'],
          }),
        },
      },
    },
    '/api/v2/buyer/orders': {
      post: {
        operationId: 'createBuyerOrder',
        summary: 'Create or resume the order for the buyer session hold',
        description: buyerOperationDescription('Creates at most one order for the owned, unexpired hold and supplied contact revision. Repeating the same logical request returns the existing order. An expired hold returns 410 and cannot be confirmed.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, key],
        requestBody: buyerRequest('BuyerOrderRequest', {
          orderFromHold: { summary: 'Create an order from the owned hold and current contact revision', value: { apiVersion: 'v2', holdId: 'hold-72', contactRevision: 4 } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerOrder', '201', 'createdOrder', 'Order created from the hold snapshot', {
            ...buyerOrderExample, quoteId: null, contactRevision: 4,
            status: 'pending', paymentStatus: 'not_started', ticketDeliveryStatus: 'pending',
          }),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '422', '429', '503', {
            '409': ['idempotencyConflict'], '410': ['sessionExpired', 'holdExpired'],
            '422': ['verificationRequired', 'salesClosed'],
          }),
        },
      },
    },
    '/api/v2/buyer/orders/{id}': {
      get: {
        operationId: 'getBuyerOrder', summary: 'Read the current order and payment state',
        description: buyerOperationDescription('Returns the owner’s current order state, including payment and ticket-delivery status. Poll this resource after payment redirects or a client timeout; do not create a second order to discover the outcome.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id],
        responses: {
          ...buyerSuccessResponse('BuyerOrder', '200', 'orderState', 'Order is paid while ticket delivery is still pending', buyerOrderExample),
          ...buyerErrors('401', '403', '404', '410', '429', '503', { '410': ['sessionExpired'], '503': ['serviceUnavailableRead'] }),
        },
      },
    },
    '/api/v2/buyer/orders/{id}/quotes': {
      post: {
        operationId: 'createBuyerQuote',
        summary: 'Calculate an authoritative quote for an order',
        description: buyerOperationDescription('The server calculates ticket subtotal, discount, fees, commission, and total in minor units. Send the expected orderRevision. Supply promoCode as a string to apply a promotion or null to explicitly clear a promotion; omission is not a clearing instruction. On HTTP 409, read the current order, compare currentRevision, then retry with refreshed data. An invalid promotion is reported as a semantic 422 response.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id, key],
        requestBody: buyerRequest('BuyerQuoteRequest', {
          quote: { summary: 'Quote without supplying a promoCode field', value: { apiVersion: 'v2', orderRevision: 8 } },
          quoteWithPromotion: { summary: 'Quote the order with a promotion code', value: { apiVersion: 'v2', orderRevision: 8, promoCode: 'AUTUMN10' } },
          clearPromotion: { summary: 'Explicitly clear the current promotion code', value: { apiVersion: 'v2', orderRevision: 8, promoCode: null } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerQuote', '200', 'authoritativeQuote', 'Server-calculated quote in integer minor units', buyerQuoteExample),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '422', '429', '503', {
            '409': ['revisionConflict', 'idempotencyConflict'], '410': ['sessionExpired', 'holdExpired'],
            '422': ['invalidPromo'],
          }),
        },
      },
    },
    '/api/v2/buyer/orders/{id}/checkout': {
      post: {
        operationId: 'checkoutBuyerOrder',
        summary: 'Accept a current quote and begin server-selected payment',
        description: buyerOperationDescription('Send both the expected quoteRevision and orderRevision. The backend validates the active hold, contact and verification requirements, accepts the quote, and creates or reuses one payment attempt. Order revision increments when a quote is accepted and on each checkout, payment, or order state change. Reads do not mutate revision. On HTTP 409, resume the session, read the order, compare currentRevision, then retry only after reconciling state. Inventory lease duration during external payment and treatment of a provider callback arriving after expiry remain backend integration decisions.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id, key],
        requestBody: buyerRequest('BuyerCheckoutRequest', {
          checkout: { summary: 'Accept the current quote and begin payment', value: { apiVersion: 'v2', quoteId: 'quote-31', quoteRevision: 2, orderRevision: 8 } },
        }),
        responses: {
          ...buyerSuccessResponse('BuyerCheckoutResult', '200', 'paidDeliveryPending', 'Payment succeeded; tickets are still being issued asynchronously', buyerPaidCheckoutExample),
          ...buyerErrors('400', '401', '403', '404', '409', '410', '422', '429', '503', {
            '409': ['revisionConflict', 'idempotencyConflict', 'priceChanged', 'layoutChanged', 'availabilityConflict'],
            '410': ['sessionExpired', 'holdExpired', 'quoteExpired'], '422': ['verificationRequired', 'paymentFailed'],
          }),
        },
      },
    },
    '/api/v2/buyer/orders/{id}/tickets': {
      get: {
        operationId: 'listBuyerOrderTickets',
        summary: 'List tickets issued or pending for an order',
        description: buyerOperationDescription('Returns only tickets belonging to this session’s order. Ticket delivery can remain pending after a successful payment. Ticket open URLs are owner-only and expire at the timestamp returned with each URL.'),
        security: buyerSessionSecurity,
        parameters: [purchaseSession, id],
        responses: {
          ...buyerSuccessResponse('BuyerTicketList', '200', 'ticketDeliveryPending', 'Payment has completed but ticket delivery is still pending', {
            apiVersion: 'v2', items: [{
              apiVersion: 'v2', ticketId: 'ticket-6', orderId: 'order-88', occurrenceId: 'concert-2026-10-28-evening',
              displayLabels: { eventTitle: 'Autumn Chamber Orchestra', occurrenceTitle: '28 October, 19:00', seat: 'A12' },
              deliveryStatus: 'pending', open: null,
            }],
          }),
          ...buyerErrors('401', '403', '404', '410', '429', '503', { '410': ['sessionExpired'], '503': ['serviceUnavailableRead'] }),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Admin/Studio JWT for v1 operations.' },
      buyerSessionAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque', description: 'Buyer-session credential issued by POST /api/v2/buyer/sessions; distinct from the purchase session ID selector.' },
    },
    parameters: {
      Id: { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
      PurchaseSessionId: {
        name: 'X-Purchase-Session-Id', in: 'header', required: true,
        description: 'Selects the current widget purchase session; it is not an authentication credential. Each widget instance has its own selector. Do not share this selector between widget instances.',
        schema: { type: 'string', minLength: 1, maxLength: 200 },
      },
      IfMatch: {
        name: 'If-Match', in: 'header', required: true,
        description: 'Quoted decimal revision, for example "4".',
        schema: { type: 'string', pattern: '^"[0-9]+"$' },
      },
      IdempotencyKey: {
        name: 'Idempotency-Key', in: 'header', required: true,
        description: 'Stable for one logical mutation; the backend scopes it to caller and route, stores the original response, and returns that same response for a retry with the same body. Reusing the key with a different body returns HTTP 409. After an uncertain timeout or client abort, retry the exact body with the same key.',
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
      BuyerSelection: z.toJSONSchema(buyerHoldRequestSchema.shape.selection.element),
      BuyerAvailability: z.toJSONSchema(buyerAvailabilitySchema),
      BuyerAvailabilityChanges: z.toJSONSchema(buyerAvailabilityChangesSchema),
      BuyerPrices: z.toJSONSchema(buyerPricesSchema),
      BuyerOccurrenceSummary: z.toJSONSchema(buyerOccurrenceListSchema.shape.items.element),
      BuyerOccurrenceList: z.toJSONSchema(buyerOccurrenceListSchema),
      BuyerLineItem: z.toJSONSchema(buyerHoldSchema.shape.lineItems.element),
      BuyerHold: z.toJSONSchema(buyerHoldSchema),
      BuyerOccurrenceContext: z.toJSONSchema(buyerOccurrenceContextSchema),
      BuyerHoldRequest: z.toJSONSchema(buyerHoldRequestSchema),
      BuyerContact: z.toJSONSchema(buyerContactWriteSchema.shape.contact),
      BuyerContactWrite: z.toJSONSchema(buyerContactWriteSchema),
      BuyerEmailVerification: z.toJSONSchema(buyerSessionContactSchema.shape.emailVerification),
      BuyerOtpChallenge: z.toJSONSchema(buyerOtpChallengeSchema),
      BuyerOtpStartRequest: z.toJSONSchema(buyerOtpStartRequestSchema),
      BuyerOtpVerifyRequest: z.toJSONSchema(buyerOtpVerifyRequestSchema),
      BuyerQuote: z.toJSONSchema(buyerQuoteSchema),
      BuyerQuoteRequest: z.toJSONSchema(buyerQuoteRequestSchema),
      BuyerOrder: z.toJSONSchema(buyerOrderSchema),
      BuyerOrderRequest: z.toJSONSchema(buyerOrderRequestSchema),
      BuyerCheckoutRequest: z.toJSONSchema(buyerCheckoutRequestSchema),
      BuyerPaymentAttempt: z.toJSONSchema(buyerPaymentAttemptSchema),
      BuyerTicketSummary: z.toJSONSchema(buyerTicketListSchema.shape.items.element),
      BuyerTicketList: z.toJSONSchema(buyerTicketListSchema),
      BuyerSessionResume: z.toJSONSchema(buyerSessionResumeSchema),
      BuyerSessionContact: z.toJSONSchema(buyerSessionContactSchema),
      BuyerSessionCreateRequest: z.toJSONSchema(buyerSessionCreateRequestSchema),
      BuyerSessionCreateResult: z.toJSONSchema(buyerSessionCreateResultSchema),
      BuyerPublicLayout: z.toJSONSchema(buyerPublicLayoutSchema),
      BuyerError: z.toJSONSchema(buyerErrorSchema),
      BuyerCheckoutResult: z.toJSONSchema(buyerCheckoutResultSchema),
    },
  },
} as const;

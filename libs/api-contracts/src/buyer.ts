import { z } from 'zod';
import { hallLayoutDraftSchema, layoutSnapshotSchema } from '@hall-platform/domain';

export const buyerApiVersionSchema = z.literal('v2');

const idSchema = z.string().min(1).max(200).refine((value) => value.trim() === value);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const dateTimeSchema = z.iso.datetime({ offset: true });
const minorAmountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const buyerSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('seat'), seatId: idSchema }),
  z.strictObject({
    kind: z.literal('generalAdmission'),
    zoneId: idSchema,
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
]);
export type BuyerSelection = z.infer<typeof buyerSelectionSchema>;

export const buyerOccurrenceSummarySchema = z.strictObject({
  occurrenceId: idSchema,
  eventId: idSchema,
  title: z.string().min(1),
  startsAt: dateTimeSchema,
  timeZone: z.string().min(1),
  venue: z.strictObject({
    name: z.string().min(1),
    city: z.string().min(1),
    address: z.string().min(1).optional(),
  }),
  poster: z.strictObject({ url: z.url({ protocol: /^https?$/ }), alt: z.string().min(1) }).optional(),
  salesStatus: z.enum(['open', 'not_yet_open', 'sold_out', 'closed']),
  currency: currencySchema,
  capabilities: z.strictObject({ seats: z.boolean(), generalAdmission: z.boolean() }),
});
export type BuyerOccurrenceSummary = z.infer<typeof buyerOccurrenceSummarySchema>;

export const buyerOccurrenceListSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  items: z.array(buyerOccurrenceSummarySchema),
  pagination: z.strictObject({ nextCursor: z.string().min(1).nullable(), hasMore: z.boolean() }),
});
export type BuyerOccurrenceList = z.infer<typeof buyerOccurrenceListSchema>;

export const buyerLineItemSchema = z.strictObject({
  label: z.string().min(1),
  quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unitPriceMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
}).refine(({ quantity, unitPriceMinor, totalMinor }) =>
  Number.isSafeInteger(quantity * unitPriceMinor) && quantity * unitPriceMinor === totalMinor,
{ path: ['totalMinor'], message: 'Line total must equal quantity times unit price' });
export type BuyerLineItem = z.infer<typeof buyerLineItemSchema>;

export const buyerHoldSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  id: idSchema,
  ownerSessionId: idSchema,
  occurrenceId: idSchema,
  layoutVersionId: idSchema,
  revision: revisionSchema,
  expiresAt: dateTimeSchema,
  serverTime: dateTimeSchema,
  selection: z.array(buyerSelectionSchema).min(1),
  lineItems: z.array(buyerLineItemSchema).min(1),
  totalMinor: minorAmountSchema,
  currency: currencySchema,
  availabilityRevision: revisionSchema,
  status: z.enum(['active', 'expired', 'cancelled', 'converted']),
}).superRefine(({ lineItems, totalMinor }, context) => {
  const sum = lineItems.reduce((value, item) => value + item.totalMinor, 0);
  if (!Number.isSafeInteger(sum) || sum !== totalMinor) context.addIssue({
    code: 'custom', path: ['totalMinor'], message: 'Hold total must equal its line item totals',
  });
});
export type BuyerHold = z.infer<typeof buyerHoldSchema>;

export const buyerOccurrenceContextSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  summary: buyerOccurrenceSummarySchema,
  layoutVersionId: idSchema,
  availabilityRevision: revisionSchema,
  pricingRevision: revisionSchema,
  serverTime: dateTimeSchema,
  ownHold: buyerHoldSchema.nullable(),
  capabilities: z.strictObject({
    promoCode: z.boolean(),
    emailVerification: z.boolean(),
    paymentMode: z.enum(['redirect', 'native', 'none']),
  }),
}).superRefine(({ summary, layoutVersionId, ownHold }, context) => {
  if (!ownHold) return;
  if (ownHold.occurrenceId !== summary.occurrenceId) context.addIssue({
    code: 'custom', path: ['ownHold', 'occurrenceId'], message: 'Hold belongs to another occurrence',
  });
  if (ownHold.layoutVersionId !== layoutVersionId) context.addIssue({
    code: 'custom', path: ['ownHold', 'layoutVersionId'], message: 'Hold belongs to another layout version',
  });
});
export type BuyerOccurrenceContext = z.infer<typeof buyerOccurrenceContextSchema>;

export const buyerHoldRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  layoutVersionId: idSchema,
  availabilityRevision: revisionSchema,
  selection: z.array(buyerSelectionSchema).min(1),
}).superRefine(({ selection }, context) => {
  const seen = new Set<string>();
  selection.forEach((item, index) => {
    const key = item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`;
    if (seen.has(key)) context.addIssue({
      code: 'custom', path: ['selection', index], message: 'Duplicate selection',
    });
    seen.add(key);
  });
});
export type BuyerHoldRequest = z.infer<typeof buyerHoldRequestSchema>;

export const buyerContactSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{5,24}$/),
  email: z.email(),
});
export type BuyerContact = z.infer<typeof buyerContactSchema>;

export const buyerContactWriteSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  contact: buyerContactSchema,
  contactRevision: revisionSchema,
});

export const buyerEmailVerificationSchema = z.strictObject({
  status: z.enum(['unverified', 'pending', 'verified']),
  verifiedEmail: z.email().nullable(),
}).refine(({ status, verifiedEmail }) =>
  (status === 'verified') === (verifiedEmail !== null),
{ path: ['verifiedEmail'], message: 'Only verified sessions have a verified email' });
export type BuyerEmailVerification = z.infer<typeof buyerEmailVerificationSchema>;

export const buyerOtpChallengeSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  challengeId: idSchema,
  destinationMasked: z.string().min(1),
  codeLength: z.number().int().min(4).max(12),
  expiresAt: dateTimeSchema,
  resendAvailableAt: dateTimeSchema,
  attemptsRemaining: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type BuyerOtpChallenge = z.infer<typeof buyerOtpChallengeSchema>;

export const buyerOtpStartRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  email: z.email(),
});
export const buyerOtpVerifyRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  code: z.string().regex(/^\d{4,12}$/),
});

export const buyerSessionCreateRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  occurrenceId: idSchema,
  hostBootstrapCredential: z.string().min(1).optional(),
});
export const buyerSessionCreateResultSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  purchaseSessionId: idSchema,
  sessionCredential: z.string().min(1),
  expiresAt: dateTimeSchema,
});

export const buyerQuoteSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  quoteId: idSchema,
  orderId: idSchema,
  revision: revisionSchema,
  expiresAt: dateTimeSchema,
  currency: currencySchema,
  lines: z.array(buyerLineItemSchema).min(1),
  ticketsSubtotalMinor: minorAmountSchema,
  discountMinor: minorAmountSchema,
  serviceFeeMinor: minorAmountSchema,
  commissionMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
  promo: z.strictObject({ status: z.enum(['none', 'applied', 'invalid', 'expired']), code: z.string().min(1).optional() }),
}).superRefine((quote, context) => {
  const lineTotal = quote.lines.reduce((value, item) => value + item.totalMinor, 0);
  if (!Number.isSafeInteger(lineTotal) || lineTotal !== quote.ticketsSubtotalMinor) context.addIssue({
    code: 'custom', path: ['ticketsSubtotalMinor'], message: 'Subtotal must equal its line item totals',
  });
  const total = quote.ticketsSubtotalMinor - quote.discountMinor + quote.serviceFeeMinor + quote.commissionMinor;
  if (!Number.isSafeInteger(total) || total < 0 || total !== quote.totalMinor) context.addIssue({
    code: 'custom', path: ['totalMinor'], message: 'Total must equal subtotal minus discount plus fees',
  });
  if (quote.discountMinor > quote.ticketsSubtotalMinor) context.addIssue({
    code: 'custom', path: ['discountMinor'], message: 'Discount cannot exceed the ticket subtotal',
  });
});
export type BuyerQuote = z.infer<typeof buyerQuoteSchema>;

export const buyerQuoteRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  orderRevision: revisionSchema,
  promoCode: z.string().trim().min(1).max(100).optional(),
});

export const buyerOrderSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  id: idSchema,
  occurrenceId: idSchema,
  layoutVersionId: idSchema,
  revision: revisionSchema,
  holdId: idSchema,
  quoteId: idSchema.nullable(),
  contactRevision: revisionSchema,
  selection: z.array(buyerSelectionSchema).min(1),
  lines: z.array(buyerLineItemSchema).min(1),
  currency: currencySchema,
  status: z.enum(['pending', 'payment_pending', 'confirmed', 'cancelled', 'expired', 'failed']),
  paymentStatus: z.enum(['not_started', 'pending', 'paid', 'failed', 'cancelled', 'refunded']),
  ticketDeliveryStatus: z.enum(['pending', 'issued', 'partial', 'failed']),
  createdAt: dateTimeSchema,
});
export type BuyerOrder = z.infer<typeof buyerOrderSchema>;

export const buyerOrderRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  holdId: idSchema,
  contactRevision: revisionSchema,
});
export const buyerCheckoutRequestSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  quoteId: idSchema,
  quoteRevision: revisionSchema,
  orderRevision: revisionSchema,
});

const safeNativePayloadSchema = z.strictObject({
  provider: idSchema,
  values: z.record(z.string().min(1), z.string().max(4096)),
}).superRefine((payload, context) => {
  Object.entries(payload.values).forEach(([key, value]) => {
    if (/^\s*javascript:/i.test(value)) context.addIssue({
      code: 'custom', path: ['values', key], message: 'Executable URLs are not allowed in payment payloads',
    });
  });
});

export const buyerPaymentAttemptSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  id: idSchema,
  orderId: idSchema,
  status: z.enum(['created', 'action_required', 'processing', 'succeeded', 'failed', 'cancelled', 'expired']),
  action: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('redirect'), url: z.url({ protocol: /^https?$/ }) }),
    z.strictObject({ kind: z.literal('native'), payload: safeNativePayloadSchema }),
    z.strictObject({ kind: z.literal('none') }),
  ]),
});
export type BuyerPaymentAttempt = z.infer<typeof buyerPaymentAttemptSchema>;

export const buyerTicketSummarySchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  ticketId: idSchema,
  orderId: idSchema,
  occurrenceId: idSchema,
  displayLabels: z.strictObject({
    eventTitle: z.string().min(1),
    occurrenceTitle: z.string().min(1),
    seat: z.string().min(1).optional(),
    zone: z.string().min(1).optional(),
  }),
  deliveryStatus: z.enum(['pending', 'issued', 'failed']),
  open: z.strictObject({ url: z.url({ protocol: /^https?$/ }), expiresAt: dateTimeSchema }).nullable(),
});
export type BuyerTicketSummary = z.infer<typeof buyerTicketSummarySchema>;
export const buyerTicketListSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  items: z.array(buyerTicketSummarySchema),
});

export const buyerCheckoutResultSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  order: buyerOrderSchema,
  paymentAttempt: buyerPaymentAttemptSchema,
});

export const buyerSessionResumeSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  purchaseSessionId: idSchema,
  occurrenceId: idSchema,
  contact: buyerContactSchema.nullable(),
  contactRevision: revisionSchema,
  emailVerification: buyerEmailVerificationSchema.nullable(),
  ownHold: buyerHoldSchema.nullable(),
  activeOrder: buyerOrderSchema.nullable(),
  activePaymentAttempt: buyerPaymentAttemptSchema.nullable(),
  serverTime: dateTimeSchema,
}).superRefine((session, context) => {
  if (session.ownHold && session.ownHold.occurrenceId !== session.occurrenceId) context.addIssue({
    code: 'custom', path: ['ownHold', 'occurrenceId'], message: 'Hold belongs to another occurrence',
  });
  if (session.activeOrder && session.activeOrder.occurrenceId !== session.occurrenceId) context.addIssue({
    code: 'custom', path: ['activeOrder', 'occurrenceId'], message: 'Order belongs to another occurrence',
  });
  if (session.ownHold && session.activeOrder && session.activeOrder.holdId !== session.ownHold.id) context.addIssue({
    code: 'custom', path: ['activeOrder', 'holdId'], message: 'Order does not reference the session hold',
  });
  if (session.ownHold && session.activeOrder &&
      session.activeOrder.layoutVersionId !== session.ownHold.layoutVersionId) context.addIssue({
    code: 'custom', path: ['activeOrder', 'layoutVersionId'], message: 'Order uses another layout version',
  });
  if (session.activePaymentAttempt && session.activeOrder &&
      session.activePaymentAttempt.orderId !== session.activeOrder.id) context.addIssue({
    code: 'custom', path: ['activePaymentAttempt', 'orderId'], message: 'Payment attempt belongs to another order',
  });
  if (session.emailVerification?.verifiedEmail &&
      session.emailVerification.verifiedEmail !== session.contact?.email) context.addIssue({
    code: 'custom', path: ['emailVerification', 'verifiedEmail'], message: 'Verified email must match the session contact',
  });
});
export type BuyerSessionResume = z.infer<typeof buyerSessionResumeSchema>;

export const buyerSessionContactSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  contact: buyerContactSchema.nullable(),
  contactRevision: revisionSchema,
  emailVerification: buyerEmailVerificationSchema.nullable(),
});

const buyerPublicSnapshotSchema = layoutSnapshotSchema.safeExtend({
  backgrounds: z.array(z.never()).length(0),
});

export const buyerPublicLayoutSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  hallName: z.string().min(1),
  snapshot: buyerPublicSnapshotSchema,
  zoneBounds: hallLayoutDraftSchema.shape.zoneBounds.optional(),
});
export type BuyerPublicLayout = z.infer<typeof buyerPublicLayoutSchema>;

export const buyerErrorSchema = z.strictObject({
  apiVersion: buyerApiVersionSchema,
  code: z.enum([
    'validation_failed', 'unauthorized', 'forbidden', 'not_found', 'revision_conflict',
    'availability_conflict', 'idempotency_conflict', 'hold_expired', 'rate_limited',
    'service_unavailable', 'session_expired', 'sales_closed', 'price_changed', 'quote_expired',
    'invalid_promo', 'verification_required', 'invalid_code', 'code_expired', 'payment_failed',
    'layout_version_conflict',
  ]),
  message: z.string().min(1),
  fieldErrors: z.array(z.strictObject({
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1),
    message: z.string().min(1),
  })).optional(),
  retryAfterMs: revisionSchema.optional(),
  currentRevision: revisionSchema.optional(),
});
export type BuyerError = z.infer<typeof buyerErrorSchema>;


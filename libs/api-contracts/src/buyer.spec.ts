import { describe, expect, it } from 'vitest';
import { createEmptyDraft } from '@hall-platform/domain';
import {
  buyerContactSchema,
  buyerErrorSchema,
  buyerHoldRequestSchema,
  buyerOccurrenceContextSchema,
  buyerOccurrenceListSchema,
  buyerOrderSchema,
  buyerOtpChallengeSchema,
  buyerPaymentAttemptSchema,
  buyerPublicLayoutSchema,
  buyerQuoteSchema,
  buyerSessionResumeSchema,
  buyerTicketSummarySchema,
} from './buyer.js';

const summary = {
  occurrenceId: 'occ-1', eventId: 'event-1', title: 'Evening concert',
  startsAt: '2026-11-01T18:00:00+03:00', timeZone: 'Europe/Moscow',
  venue: { name: 'Main Hall', city: 'Moscow' }, salesStatus: 'open', currency: 'RUB',
  capabilities: { seats: true, generalAdmission: true },
};

const hold = {
  apiVersion: 'v2', id: 'hold-1', ownerSessionId: 'session-1', occurrenceId: 'occ-1',
  layoutVersionId: 'layout-1', revision: 3,
  expiresAt: '2026-11-01T17:50:00+03:00', serverTime: '2026-11-01T17:40:00+03:00',
  selection: [
    { kind: 'seat', seatId: 'seat-1' },
    { kind: 'generalAdmission', zoneId: 'zone-ga', quantity: 2 },
  ],
  lineItems: [
    { label: 'Row A, seat 1', quantity: 1, unitPriceMinor: 10000, totalMinor: 10000 },
    { label: 'Standing', quantity: 2, unitPriceMinor: 5000, totalMinor: 10000 },
  ],
  totalMinor: 20000, currency: 'RUB', availabilityRevision: 7, status: 'active',
};

const quote = {
  apiVersion: 'v2', quoteId: 'quote-1', orderId: 'order-1', revision: 2,
  expiresAt: '2026-11-01T17:48:00+03:00', currency: 'RUB',
  lines: [
    { label: 'Row A, seat 1', quantity: 1, unitPriceMinor: 10000, totalMinor: 10000 },
    { label: 'Standing', quantity: 2, unitPriceMinor: 5000, totalMinor: 10000 },
  ],
  ticketsSubtotalMinor: 20000, discountMinor: 1000, serviceFeeMinor: 500,
  commissionMinor: 250, totalMinor: 19750,
  promo: { status: 'applied', code: 'SAVE' },
};

describe('v2 buyer contracts', () => {
  it('lists occurrence summaries with pagination and no hall geometry', () => {
    const listing = {
      apiVersion: 'v2', items: [summary],
      pagination: { nextCursor: null, hasMore: false },
    };
    expect(buyerOccurrenceListSchema.parse(listing)).toEqual(listing);
    expect(buyerOccurrenceListSchema.safeParse({
      ...listing, items: [{ ...summary, layout: { snapshot: {} } }],
    }).success).toBe(false);
  });

  it('accepts seat and GA selection and rejects an occurrence or layout mismatch', () => {
    const request = {
      apiVersion: 'v2', layoutVersionId: 'layout-1', availabilityRevision: 7,
      selection: hold.selection,
    };
    expect(buyerHoldRequestSchema.parse(request)).toEqual(request);
    expect(buyerHoldRequestSchema.safeParse({
      ...request, selection: [{ kind: 'generalAdmission', zoneId: 'zone-ga', quantity: 0 }],
    }).success).toBe(false);

    const context = {
      apiVersion: 'v2', summary, layoutVersionId: 'layout-1',
      availabilityRevision: 7, pricingRevision: 4,
      serverTime: '2026-11-01T17:40:00+03:00', ownHold: hold,
      capabilities: { promoCode: true, emailVerification: true, paymentMode: 'redirect' },
    };
    expect(buyerOccurrenceContextSchema.parse(context)).toEqual(context);
    expect(buyerOccurrenceContextSchema.safeParse({
      ...context, ownHold: { ...hold, occurrenceId: 'occ-foreign' },
    }).success).toBe(false);
    expect(buyerOccurrenceContextSchema.safeParse({
      ...context, ownHold: { ...hold, layoutVersionId: 'layout-old' },
    }).success).toBe(false);
  });

  it('enforces authoritative quote totals and safe minor-unit arithmetic', () => {
    expect(buyerQuoteSchema.parse(quote)).toEqual(quote);
    expect(buyerQuoteSchema.safeParse({ ...quote, totalMinor: 19749 }).success).toBe(false);
    expect(buyerQuoteSchema.safeParse({
      ...quote, ticketsSubtotalMinor: Number.MAX_SAFE_INTEGER,
      serviceFeeMinor: Number.MAX_SAFE_INTEGER, discountMinor: 0,
      commissionMinor: 0, totalMinor: Number.MAX_SAFE_INTEGER,
    }).success).toBe(false);
    expect(buyerQuoteSchema.safeParse({
      ...quote, lines: [{ ...quote.lines[0], totalMinor: 9999 }],
    }).success).toBe(false);
  });

  it('rejects every editor background and asset from the v2 public layout', () => {
    const draft = createEmptyDraft('Public hall');
    const layout = { apiVersion: 'v2', hallName: draft.hallName, snapshot: draft.snapshot, zoneBounds: {} };
    expect(buyerPublicLayoutSchema.parse(layout)).toEqual(layout);

    const background = {
      id: 'background-1', floorId: draft.snapshot.floors[0].id, order: 0,
      position: { x: 0, y: 0 }, scale: 1, rotationRadians: 0, opacity: 1,
      visible: true, locked: false,
    };
    expect(buyerPublicLayoutSchema.safeParse({
      ...layout,
      snapshot: { ...draft.snapshot, backgrounds: [{ ...background, source: {
        kind: 'image', assetId: 'asset-image', mimeType: 'image/png',
      } }] },
    }).success).toBe(false);
    expect(buyerPublicLayoutSchema.safeParse({
      ...layout,
      snapshot: { ...draft.snapshot, backgrounds: [{ ...background, source: {
        kind: 'pdf', assetId: 'asset-pdf', pageNumber: 1,
      } }] },
    }).success).toBe(false);
    expect(buyerPublicLayoutSchema.safeParse({
      ...layout,
      snapshot: { ...draft.snapshot, backgrounds: [{ ...background, source: {
        kind: 'blob', assetId: 'asset-blob',
      } }] },
    }).success).toBe(false);
    expect(buyerPublicLayoutSchema.safeParse({ ...layout, assets: { secret: 'blob' } }).success).toBe(false);
  });

  it('accepts international contact phone numbers without a fixed country code', () => {
    const contact = {
      firstName: 'Alex', lastName: 'Kim', phone: '+1 202 555 0123', email: 'alex@example.com',
    };
    expect(buyerContactSchema.parse(contact)).toEqual(contact);
    expect(buyerContactSchema.safeParse({ ...contact, phone: '' }).success).toBe(false);
  });

  it('resumes converted holds and the existing order without duplicating the purchase', () => {
    const order = {
      apiVersion: 'v2', id: 'order-1', occurrenceId: 'occ-1', layoutVersionId: 'layout-1',
      revision: 4, holdId: 'hold-1', quoteId: 'quote-1', contactRevision: 5,
      selection: hold.selection,
      lines: [
        { label: 'Row A, seat 1', quantity: 1, unitPriceMinor: 10000, totalMinor: 10000 },
        { label: 'Standing', quantity: 2, unitPriceMinor: 5000, totalMinor: 10000 },
      ],
      currency: 'RUB', status: 'payment_pending', paymentStatus: 'pending',
      ticketDeliveryStatus: 'pending', createdAt: '2026-11-01T17:40:00+03:00',
    };
    expect(buyerOrderSchema.parse(order)).toEqual(order);

    const resume = {
      apiVersion: 'v2', purchaseSessionId: 'session-1', occurrenceId: 'occ-1',
      contact: { firstName: 'Alex', lastName: 'Kim', phone: '+1 202 555 0123', email: 'alex@example.com' },
      contactRevision: 5,
      emailVerification: { status: 'verified', verifiedEmail: 'alex@example.com' },
      ownHold: { ...hold, status: 'converted' }, activeOrder: order,
      activePaymentAttempt: null, serverTime: '2026-11-01T17:41:00+03:00',
    };
    expect(buyerSessionResumeSchema.parse(resume)).toEqual(resume);
    expect(buyerSessionResumeSchema.safeParse({
      ...resume, activeOrder: { ...order, occurrenceId: 'occ-foreign' },
    }).success).toBe(false);
    expect(buyerSessionResumeSchema.parse({
      ...resume, ownHold: null, activeOrder: null, activePaymentAttempt: null,
    }).activeOrder).toBeNull();
  });

  it('rejects executable redirect URLs and OTP responses containing a code', () => {
    expect(buyerPaymentAttemptSchema.safeParse({
      apiVersion: 'v2', id: 'payment-1', orderId: 'order-1', status: 'action_required',
      action: { kind: 'redirect', url: 'javascript:alert(1)' },
    }).success).toBe(false);
    expect(buyerPaymentAttemptSchema.safeParse({
      apiVersion: 'v2', id: 'payment-1', orderId: 'order-1', status: 'action_required',
      action: { kind: 'native', payload: { provider: 'bank', values: { token: 'token-1' } } },
      script: 'alert(1)',
    }).success).toBe(false);

    const challenge = {
      apiVersion: 'v2', challengeId: 'otp-1', destinationMasked: '+1******123',
      codeLength: 6, expiresAt: '2026-11-01T17:45:00+03:00',
      resendAvailableAt: '2026-11-01T17:42:00+03:00', attemptsRemaining: 3,
    };
    expect(buyerOtpChallengeSchema.parse(challenge)).toEqual(challenge);
    expect(buyerOtpChallengeSchema.safeParse({ ...challenge, code: '123456' }).success).toBe(false);
  });

  it('requires issued ticket open URLs to use expiring web links', () => {
    const ticket = {
      apiVersion: 'v2', ticketId: 'ticket-1', orderId: 'order-1', occurrenceId: 'occ-1',
      displayLabels: { eventTitle: 'Concert', occurrenceTitle: 'Evening', seat: 'Row A, seat 1' },
      deliveryStatus: 'issued',
      open: { url: 'https://tickets.example/ticket-1', expiresAt: '2026-11-01T18:00:00+03:00' },
    };
    expect(buyerTicketSummarySchema.parse(ticket)).toEqual(ticket);
    expect(buyerTicketSummarySchema.safeParse({
      ...ticket, open: { ...ticket.open, url: 'javascript:alert(1)' },
    }).success).toBe(false);
    expect(buyerTicketSummarySchema.parse({ ...ticket, deliveryStatus: 'pending', open: null }).open).toBeNull();
  });

  it('allows buyer errors to carry a field path and retry or revision hints', () => {
    expect(buyerErrorSchema.parse({
      apiVersion: 'v2', code: 'price_changed', message: 'Price changed',
      fieldErrors: [{ path: ['contact', 'email'], message: 'Enter a valid email' }],
      retryAfterMs: 1000, currentRevision: 8,
    })).toMatchObject({ code: 'price_changed', currentRevision: 8 });
    expect(buyerErrorSchema.safeParse({
      apiVersion: 'v2', code: 'unknown', message: 'Unknown error',
    }).success).toBe(false);
  });
});

import { z } from 'zod';
import { buyerPaymentAttemptSchema } from '@hall-platform/api-contracts';

const envelope = {
  version: z.literal(1),
  instanceId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
};

const themeSchema = z.strictObject({
  accent: z.string().max(128).optional(),
  ink: z.string().max(128).optional(),
  surface: z.string().max(128).optional(),
  muted: z.string().max(128).optional(),
  border: z.string().max(128).optional(),
  background: z.string().max(128).optional(),
  fontFamily: z.string().max(256).optional(),
  radius: z.string().max(64).optional(),
});

export const hostBridgeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('init'), payload: z.strictObject({
    eventId: z.string().min(1).max(128),
    occurrenceId: z.string().min(1).max(128),
    apiBaseUrl: z.url({ protocol: /^https?$/ }).optional(),
    hostBootstrapCredential: z.string().min(1).max(8192).optional(),
    session: z.strictObject({
      purchaseSessionId: z.string().min(1).max(128),
      sessionCredential: z.string().min(1).max(8192),
    }).optional(),
    locale: z.string().min(2).max(64).optional(),
    theme: themeSchema.optional(),
    hostCapabilities: z.array(z.enum(['back', 'resume', 'payment', 'tickets', 'history', 'eventDetails'])).max(20).default([]),
  }) }),
  z.strictObject({ ...envelope, type: z.literal('back'), payload: z.strictObject({}) }),
  z.strictObject({ ...envelope, type: z.literal('resume'), payload: z.strictObject({}) }),
  z.strictObject({ ...envelope, type: z.literal('authUpdated'), payload: z.strictObject({
    hostBootstrapCredential: z.string().min(1).max(8192).optional(),
    purchaseSessionId: z.string().min(1).max(128).optional(),
    sessionCredential: z.string().min(1).max(8192).optional(),
  }).refine((payload) => {
    const hasSessionId = Boolean(payload.purchaseSessionId);
    const hasSessionCredential = Boolean(payload.sessionCredential);
    return hasSessionId === hasSessionCredential && Boolean(payload.hostBootstrapCredential || (hasSessionId && hasSessionCredential));
  }, {
    message: 'An auth update must include a refreshed credential',
  }) }),
  z.strictObject({ ...envelope, type: z.literal('paymentReturned'), payload: z.strictObject({
    orderId: z.string().min(1).max(128),
  }) }),
  z.strictObject({ ...envelope, type: z.literal('ack'), payload: z.strictObject({
    requestId: z.string().min(1).max(128),
    ok: z.boolean(),
    error: z.string().max(500).optional(),
  }) }),
]);

export const widgetBridgeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('ready'), payload: z.strictObject({ path: z.string().max(512) }) }),
  z.strictObject({ ...envelope, type: z.literal('stateChanged'), payload: z.strictObject({ step: z.enum(['selection', 'contacts', 'payment', 'success']), canGoBack: z.boolean() }) }),
  z.strictObject({ ...envelope, type: z.literal('closeRequested'), payload: z.strictObject({}) }),
  z.strictObject({ ...envelope, type: z.literal('eventDetailsRequested'), payload: z.strictObject({ eventId: z.string().min(1).max(128) }) }),
  z.strictObject({ ...envelope, type: z.literal('paymentRequested'), payload: z.strictObject({ attempt: buyerPaymentAttemptSchema }) }),
  z.strictObject({ ...envelope, type: z.literal('sessionCreated'), payload: z.strictObject({
    purchaseSessionId: z.string().min(1).max(128), sessionCredential: z.string().min(1).max(8192), expiresAt: z.iso.datetime(),
  }) }),
  z.strictObject({ ...envelope, type: z.literal('orderConfirmed'), payload: z.strictObject({
    orderId: z.string().min(1).max(128), status: z.literal('confirmed'), paymentStatus: z.literal('paid'),
    ticketDeliveryStatus: z.enum(['pending', 'issued', 'partial', 'failed']),
  }) }),
  z.strictObject({ ...envelope, type: z.literal('ticketsRequested'), payload: z.strictObject({ ticketIds: z.array(z.string().min(1).max(128)).min(1).max(100) }) }),
  z.strictObject({ ...envelope, type: z.literal('historyRequested'), payload: z.strictObject({}) }),
  z.strictObject({ ...envelope, type: z.literal('ack'), payload: z.strictObject({ requestId: z.string().min(1).max(128), ok: z.boolean(), error: z.string().max(500).optional() }) }),
  z.strictObject({ ...envelope, type: z.literal('error'), payload: z.strictObject({ code: z.string().min(1).max(128), message: z.string().min(1).max(500) }) }),
]);

export type HostBridgeMessage = z.infer<typeof hostBridgeMessageSchema>;
export type WidgetBridgeMessage = z.infer<typeof widgetBridgeMessageSchema>;
export type HostInitMessage = Extract<HostBridgeMessage, { type: 'init' }>;

export function createBridgeRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

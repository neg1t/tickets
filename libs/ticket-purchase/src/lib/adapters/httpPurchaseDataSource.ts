import { createBuyerApiClient, type BuyerApiClientOptions } from '@hall-platform/api-axios';
import type { PurchaseDataSource } from '../model/purchase.types.js';

export type HttpPurchaseDataSource = PurchaseDataSource & { dispose(): void };

/** Create an HTTP-backed source scoped to one widget instance. */
export function createHttpPurchaseDataSource(options: BuyerApiClientOptions): HttpPurchaseDataSource {
  const client = createBuyerApiClient(options);
  return {
    createSession: (input, idempotencyKey, signal) => client.createSession(input, idempotencyKey, signal),
    resumeSession: (purchaseSessionId, signal) => client.resumeSession(purchaseSessionId, signal),
    getContext: (purchaseSessionId, occurrenceId, signal) => client.getContext(purchaseSessionId, occurrenceId, signal),
    listOccurrences: (eventId, cursor, signal) => client.listOccurrences(eventId, cursor, signal),
    getSeatMap: (occurrenceId, signal) => client.getSeatMap(occurrenceId, signal),
    getAvailability: (occurrenceId, signal) => client.getAvailability(occurrenceId, signal),
    getPrices: (occurrenceId, signal) => client.getPrices(occurrenceId, signal),
    getChanges: (occurrenceId, sinceRevision, signal) => client.getChanges(occurrenceId, sinceRevision, signal),
    createHold: (purchaseSessionId, occurrenceId, request, idempotencyKey, signal) =>
      client.createHold(purchaseSessionId, occurrenceId, request, idempotencyKey, signal),
    getHold: (purchaseSessionId, holdId, signal) => client.getHold(purchaseSessionId, holdId, signal),
    cancelHold: (purchaseSessionId, holdId, expectedRevision, idempotencyKey, signal) =>
      client.cancelHold(purchaseSessionId, holdId, expectedRevision, idempotencyKey, signal),
    saveContact: (purchaseSessionId, contact, contactRevision, idempotencyKey, signal) =>
      client.saveContact(purchaseSessionId, contact, contactRevision, idempotencyKey, signal),
    requestEmail: (purchaseSessionId, email, idempotencyKey, signal) =>
      client.requestEmail(purchaseSessionId, email, idempotencyKey, signal),
    verifyEmail: (purchaseSessionId, challengeId, code, idempotencyKey, signal) =>
      client.verifyEmail(purchaseSessionId, challengeId, code, idempotencyKey, signal),
    createOrder: (purchaseSessionId, holdId, contactRevision, idempotencyKey, signal) =>
      client.createOrder(purchaseSessionId, holdId, contactRevision, idempotencyKey, signal),
    getOrder: (purchaseSessionId, orderId, signal) => client.getOrder(purchaseSessionId, orderId, signal),
    createQuote: (purchaseSessionId, orderId, orderRevision, promoCode, idempotencyKey, signal) =>
      client.createQuote(purchaseSessionId, orderId, orderRevision, promoCode, idempotencyKey, signal),
    checkout: (purchaseSessionId, orderId, quote, idempotencyKey, signal) =>
      client.checkout(purchaseSessionId, orderId, {
        apiVersion: 'v2', quoteId: quote.quoteId,
        quoteRevision: quote.quoteRevision, orderRevision: quote.orderRevision,
      }, idempotencyKey, signal),
    getTickets: (purchaseSessionId, orderId, signal) => client.getTickets(purchaseSessionId, orderId, signal),
    dispose: () => client.dispose(),
  };
}

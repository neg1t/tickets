import type {
  BuyerAvailability,
  BuyerAvailabilityChanges,
  BuyerCheckoutResult,
  BuyerContact,
  BuyerHold,
  BuyerHoldRequest,
  BuyerOccurrenceContext,
  BuyerOccurrenceList,
  BuyerOrder,
  BuyerPrices,
  BuyerPublicLayout,
  BuyerQuote,
  BuyerSelection,
  BuyerSessionResume,
  BuyerSessionContact,
  BuyerSessionCreateResult,
  BuyerOtpChallenge,
  BuyerTicketSummary,
} from '@hall-platform/api-contracts';

export type PurchaseSession = BuyerSessionCreateResult;
export type PurchaseSessionContact = BuyerSessionContact;
export type PurchaseEmailChallenge = BuyerOtpChallenge;
export type PurchaseSessionCreateInput = {
  readonly occurrenceId: string;
  readonly hostBootstrapCredential?: string;
};

/** A per-widget boundary for all buyer purchase reads and mutations. */
export interface PurchaseDataSource {
  createSession(input: PurchaseSessionCreateInput, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseSession>;
  resumeSession(purchaseSessionId: string, signal?: AbortSignal): Promise<BuyerSessionResume>;
  getContext(purchaseSessionId: string, occurrenceId: string, signal?: AbortSignal): Promise<BuyerOccurrenceContext>;
  listOccurrences(eventId: string, cursor: string | null, signal?: AbortSignal): Promise<BuyerOccurrenceList>;
  getSeatMap(occurrenceId: string, signal?: AbortSignal): Promise<BuyerPublicLayout>;
  getAvailability(occurrenceId: string, signal?: AbortSignal): Promise<BuyerAvailability>;
  getPrices(occurrenceId: string, signal?: AbortSignal): Promise<BuyerPrices>;
  getChanges(occurrenceId: string, sinceRevision: number, signal?: AbortSignal): Promise<BuyerAvailabilityChanges>;
  createHold(purchaseSessionId: string, occurrenceId: string, request: BuyerHoldRequest, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerHold>;
  getHold(purchaseSessionId: string, holdId: string, signal?: AbortSignal): Promise<BuyerHold>;
  cancelHold(purchaseSessionId: string, holdId: string, expectedRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<void>;
  saveContact(purchaseSessionId: string, contact: BuyerContact, contactRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseSessionContact>;
  requestEmail(purchaseSessionId: string, email: string, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseEmailChallenge>;
  verifyEmail(purchaseSessionId: string, challengeId: string, code: string, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseSessionContact>;
  createOrder(purchaseSessionId: string, holdId: string, contactRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerOrder>;
  getOrder(purchaseSessionId: string, orderId: string, signal?: AbortSignal): Promise<BuyerOrder>;
  createQuote(purchaseSessionId: string, orderId: string, orderRevision: number, promoCode: string | null | undefined, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerQuote>;
  checkout(purchaseSessionId: string, orderId: string, quote: { readonly quoteId: string; readonly quoteRevision: number; readonly orderRevision: number }, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerCheckoutResult>;
  getTickets(purchaseSessionId: string, orderId: string, signal?: AbortSignal): Promise<BuyerTicketSummary[]>;
}

export class PurchaseConfigurationError extends Error {
  constructor(message = 'A purchase data source must be configured before this widget can run') {
    super(message);
    this.name = 'PurchaseConfigurationError';
  }
}

export function requirePurchaseDataSource(source: PurchaseDataSource | undefined): PurchaseDataSource {
  if (!source) throw new PurchaseConfigurationError();
  return source;
}

export type PurchaseSelection = readonly BuyerSelection[];

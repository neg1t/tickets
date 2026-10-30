import { BuyerApiError } from '@hall-platform/api-axios';
import {
  buyerAvailabilityChangesSchema,
  buyerAvailabilitySchema,
  buyerCheckoutResultSchema,
  buyerContactSchema,
  buyerHoldSchema,
  buyerOccurrenceContextSchema,
  buyerOccurrenceListSchema,
  buyerOrderSchema,
  buyerPricesSchema,
  buyerPublicLayoutSchema,
  buyerQuoteSchema,
  buyerSessionContactSchema,
  buyerSessionCreateResultSchema,
  buyerSessionResumeSchema,
  buyerTicketListSchema,
  type BuyerAvailability,
  type BuyerAvailabilityChanges,
  type BuyerCheckoutResult,
  type BuyerContact,
  type BuyerHold,
  type BuyerHoldRequest,
  type BuyerOccurrenceContext,
  type BuyerOccurrenceList,
  type BuyerOrder,
  type BuyerPrices,
  type BuyerPublicLayout,
  type BuyerQuote,
  type BuyerSessionResume,
  type BuyerTicketSummary,
} from '@hall-platform/api-contracts';
import { createEmptyDraft, layoutSnapshotSchema } from '@hall-platform/domain';
import {
  PurchaseConfigurationError,
  type PurchaseDataSource,
  type PurchaseEmailChallenge,
  type PurchaseSession,
  type PurchaseSessionContact,
  type PurchaseSessionCreateInput,
} from '@hall-platform/ticket-purchase';

export type MockPurchaseDataOperation = keyof PurchaseDataSource;

export type MockPurchaseDataSourceOptions = {
  readonly now?: () => Date;
  readonly latencyMs?: number;
  readonly wait?: (operation: MockPurchaseDataOperation, signal?: AbortSignal) => Promise<void>;
  readonly holdDurationMs?: number;
  readonly sessionDurationMs?: number;
  readonly otpCode?: string;
  readonly pendingPayment?: boolean;
  /** `none` means the backend advances payment without a redirect or native host action. */
  readonly paymentMode?: 'redirect' | 'native' | 'none';
  readonly stalePriceBeforeFirstHold?: boolean;
  readonly zonePriceAfterStaleMinor?: number;
  readonly seatPriceAfterStaleMinor?: number;
  readonly idFactory?: (kind: string) => string;
  readonly failures?: readonly {
    readonly operation: MockPurchaseDataOperation;
    readonly code: string;
    readonly message: string;
    readonly count?: number;
  }[];
};

type SessionState = {
  id: string;
  credential: string;
  occurrenceId: string;
  expiresAt: string;
  contact: BuyerContact | null;
  contactRevision: number;
  emailVerification: PurchaseSessionContact['emailVerification'];
  holdId: string | null;
  orderId: string | null;
  paymentAttempt: BuyerCheckoutResult['paymentAttempt'] | null;
};

type ChallengeState = PurchaseEmailChallenge & {
  readonly purchaseSessionId: string;
  readonly email: string;
};

const API_VERSION = 'v2' as const;
const OCCURRENCE_ID = 'demo-occurrence';
const EVENT_ID = 'demo-event';
const LAYOUT_VERSION_ID = 'demo-layout-v1';
const SEAT_ID = 'demo-seat-a';
const ZONE_ID = 'demo-ga';
const CURRENCY = 'RUB';

function asIso(value: Date): string {
  return value.toISOString();
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function makeError(code: string, message: string, currentRevision?: number): BuyerApiError {
  return new BuyerApiError(code, message, currentRevision);
}

function makePublicLayout(): BuyerPublicLayout {
  const draft = createEmptyDraft('Демо зал');
  const floor = draft.snapshot.floors[0];
  if (!floor) throw new Error('Demo layout must contain its primary floor');
  const snapshot = layoutSnapshotSchema.parse({
    ...draft.snapshot,
    id: 'demo-snapshot',
    layoutVersionId: LAYOUT_VERSION_ID,
    floors: [{ ...floor, id: 'demo-floor', layoutVersionId: LAYOUT_VERSION_ID }],
    zones: [{ id: ZONE_ID, floorId: 'demo-floor', name: 'Партер', kind: 'ga', capacity: 200 }],
    seats: [{ id: SEAT_ID, floorId: 'demo-floor', label: 'A-1', position: { x: 0, y: 0 }, placement: { kind: 'standalone' } }],
    backgrounds: [],
  });
  return buyerPublicLayoutSchema.parse({ apiVersion: API_VERSION, hallName: draft.hallName, snapshot });
}

export function createMockPurchaseDataSource(options: MockPurchaseDataSourceOptions = {}): PurchaseDataSource {
  const now = options.now ?? (() => new Date());
  const holdDurationMs = options.holdDurationMs ?? 15 * 60 * 1_000;
  const sessionDurationMs = options.sessionDurationMs ?? 24 * 60 * 60 * 1_000;
  const otpCode = options.otpCode ?? '246810';
  const pendingPayment = options.pendingPayment ?? true;
  const paymentMode = options.paymentMode ?? (pendingPayment ? 'redirect' : 'none');
  const idFactory = options.idFactory ?? ((kind: string) => `${kind}-${crypto.randomUUID()}`);
  const sessions = new Map<string, SessionState>();
  const holds = new Map<string, BuyerHold>();
  const orders = new Map<string, BuyerOrder>();
  const quotes = new Map<string, BuyerQuote>();
  const challenges = new Map<string, ChallengeState>();
  const idempotentResults = new Map<string, { fingerprint: string; result: unknown }>();
  const remainingFailures = new Map(options.failures?.map((failure) => [failure.operation, failure.count ?? 1]));
  let pricingRevision = 1;
  let availabilityRevision = 1;
  let gaAvailable = 200;
  let zonePriceMinor = 4_500;
  let seatPriceMinor = 12_500;
  let stalePriceBeforeFirstHold = options.stalePriceBeforeFirstHold ?? false;
  const publicLayout = makePublicLayout();

  async function wait(operation: MockPurchaseDataOperation, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw makeError('cancelled', 'Request cancelled');
    if (options.wait) await options.wait(operation, signal);
    else if ((options.latencyMs ?? 0) > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener?.('abort', abort);
          resolve();
        }, options.latencyMs);
        const abort = () => {
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', abort);
          reject(makeError('cancelled', 'Request cancelled'));
        };
        signal?.addEventListener?.('abort', abort, { once: true });
      });
    }
    if (signal?.aborted) throw makeError('cancelled', 'Request cancelled');
    const left = remainingFailures.get(operation) ?? 0;
    if (left > 0) {
      remainingFailures.set(operation, left - 1);
      const failure = options.failures?.find((item) => item.operation === operation);
      if (failure) throw makeError(failure.code, failure.message);
    }
  }

  function requireSession(purchaseSessionId: string): SessionState {
    const session = sessions.get(purchaseSessionId);
    if (!session || Date.parse(session.expiresAt) <= now().getTime())
      throw makeError('session_expired', 'Purchase session is unavailable');
    return session;
  }

  async function read<T>(operation: MockPurchaseDataOperation, signal: AbortSignal | undefined, action: () => T): Promise<T> {
    await wait(operation, signal);
    return copy(action());
  }

  async function mutate<T>(
    operation: MockPurchaseDataOperation,
    purchaseSessionId: string,
    idempotencyKey: string,
    payload: unknown,
    signal: AbortSignal | undefined,
    action: () => T,
  ): Promise<T> {
    await wait(operation, signal);
    if (!idempotencyKey.trim()) throw makeError('validation_failed', 'Idempotency-Key is required');
    const key = `${purchaseSessionId}:${operation}:${idempotencyKey}`;
    const fingerprint = JSON.stringify(payload);
    requireSession(purchaseSessionId);
    const prior = idempotentResults.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw makeError('idempotency_conflict', 'Key was already used with a different request');
      return copy(prior.result as T);
    }
    const result = action();
    idempotentResults.set(key, { fingerprint, result: copy(result) });
    return copy(result);
  }

  function expireHoldIfNeeded(hold: BuyerHold): BuyerHold {
    if (hold.status === 'active' && Date.parse(hold.expiresAt) <= now().getTime()) {
      const expired = buyerHoldSchema.parse({ ...hold, revision: hold.revision + 1, status: 'expired', serverTime: asIso(now()) });
      holds.set(hold.id, expired);
      gaAvailable += hold.selection.reduce((total, item) => total + (item.kind === 'generalAdmission' ? item.quantity : 0), 0);
      availabilityRevision += 1;
      return expired;
    }
    return hold;
  }

  function expireActiveHolds(): void {
    for (const hold of holds.values()) expireHoldIfNeeded(hold);
  }

  function getHoldForSession(session: SessionState): BuyerHold | null {
    if (!session.holdId) return null;
    const hold = holds.get(session.holdId);
    return hold ? expireHoldIfNeeded(hold) : null;
  }

  function buildAvailability(): BuyerAvailability {
    expireActiveHolds();
    const seatHold = [...holds.values()].some((hold) => hold.occurrenceId === OCCURRENCE_ID &&
      (hold.status === 'active' || hold.status === 'converted') && hold.selection.some((item) => item.kind === 'seat' && item.seatId === SEAT_ID));
    const seatSold = [...orders.values()].some((order) => order.status === 'confirmed' && order.selection.some((item) => item.kind === 'seat' && item.seatId === SEAT_ID));
    return buyerAvailabilitySchema.parse({
      apiVersion: API_VERSION,
      occurrenceId: OCCURRENCE_ID,
      layoutVersionId: LAYOUT_VERSION_ID,
      revision: availabilityRevision,
      serverTime: asIso(now()),
      seats: { [SEAT_ID]: seatSold ? 'sold' : seatHold ? 'held' : 'available' },
      zones: { [ZONE_ID]: { available: gaAvailable, maxPerOrder: 8 } },
    });
  }

  function lineItemsFor(selection: BuyerHoldRequest['selection']) {
    return selection.map((item) => {
      const quantity = item.kind === 'seat' ? 1 : item.quantity;
      const unitPriceMinor = item.kind === 'seat' ? seatPriceMinor : zonePriceMinor;
      const label = item.kind === 'seat' ? 'A-1' : 'Партер';
      return { label, quantity, unitPriceMinor, totalMinor: quantity * unitPriceMinor };
    });
  }

  function requireOrder(purchaseSessionId: string, orderId: string): BuyerOrder {
    const session = requireSession(purchaseSessionId);
    const order = orders.get(orderId);
    const ownerSessionId = order ? holds.get(order.holdId)?.ownerSessionId : undefined;
    if (!order || ownerSessionId !== purchaseSessionId || order.occurrenceId !== session.occurrenceId)
      throw makeError('not_found', 'Order not found for purchase session');
    return order;
  }

  function currentPayment(session: SessionState) {
    return session.paymentAttempt;
  }

  return {
    createSession(input: PurchaseSessionCreateInput, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseSession> {
      return (async () => {
        await wait('createSession', signal);
        if (!idempotencyKey.trim()) throw makeError('validation_failed', 'Idempotency-Key is required');
        const fingerprint = JSON.stringify(input);
        const key = `new-session:createSession:${idempotencyKey}`;
        const prior = idempotentResults.get(key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw makeError('idempotency_conflict', 'Key was already used with a different request');
          return copy(prior.result as PurchaseSession);
        }
        const id = idFactory('session');
        const result = buyerSessionCreateResultSchema.parse({
          apiVersion: API_VERSION, purchaseSessionId: id,
          sessionCredential: `demo-credential-${id}`, expiresAt: asIso(new Date(now().getTime() + sessionDurationMs)),
        });
        sessions.set(id, {
          id, credential: result.sessionCredential, occurrenceId: input.occurrenceId,
          expiresAt: result.expiresAt, contact: null, contactRevision: 0, emailVerification: null,
          holdId: null, orderId: null, paymentAttempt: null,
        });
        idempotentResults.set(key, { fingerprint, result: copy(result) });
        return copy(result);
      })();
    },
    resumeSession(purchaseSessionId: string, signal?: AbortSignal): Promise<BuyerSessionResume> {
      return read('resumeSession', signal, () => {
        const session = requireSession(purchaseSessionId);
        const hold = getHoldForSession(session);
        const activeOrder = session.orderId ? orders.get(session.orderId) ?? null : null;
        return buyerSessionResumeSchema.parse({
          apiVersion: API_VERSION, purchaseSessionId, occurrenceId: session.occurrenceId,
          contact: session.contact, contactRevision: session.contactRevision,
          emailVerification: session.emailVerification, ownHold: hold,
          activeOrder, activePaymentAttempt: currentPayment(session), serverTime: asIso(now()),
        });
      });
    },
    getContext(purchaseSessionId: string, occurrenceId: string, signal?: AbortSignal): Promise<BuyerOccurrenceContext> {
      return read('getContext', signal, () => {
        const session = requireSession(purchaseSessionId);
        if (session.occurrenceId !== occurrenceId) throw makeError('not_found', 'Occurrence not found in this session');
        return buyerOccurrenceContextSchema.parse({
          apiVersion: API_VERSION,
          summary: {
            occurrenceId, eventId: EVENT_ID, title: 'Демо событие', startsAt: asIso(new Date(now().getTime() + 7 * 24 * 60 * 60 * 1_000)),
            timeZone: 'Asia/Krasnoyarsk', venue: { name: 'Демо зал', city: 'Красноярск' },
            salesStatus: 'open', currency: CURRENCY, capabilities: { seats: true, generalAdmission: true },
          },
          layoutVersionId: LAYOUT_VERSION_ID, availabilityRevision, pricingRevision,
          serverTime: asIso(now()), ownHold: getHoldForSession(session),
          capabilities: { promoCode: true, emailVerification: true, paymentMode },
        });
      });
    },
    listOccurrences(eventId: string, cursor: string | null, signal?: AbortSignal): Promise<BuyerOccurrenceList> {
      return read('listOccurrences', signal, () => buyerOccurrenceListSchema.parse({
        apiVersion: API_VERSION,
        items: eventId === EVENT_ID ? [{
          occurrenceId: OCCURRENCE_ID, eventId, title: 'Демо событие', startsAt: asIso(new Date(now().getTime() + 7 * 24 * 60 * 60 * 1_000)),
          timeZone: 'Asia/Krasnoyarsk', venue: { name: 'Демо зал', city: 'Красноярск' },
          salesStatus: 'open', currency: CURRENCY, capabilities: { seats: true, generalAdmission: true },
        }] : [],
        pagination: { nextCursor: null, hasMore: false },
        ...(cursor === null ? {} : {}),
      }));
    },
    getSeatMap(occurrenceId: string, signal?: AbortSignal): Promise<BuyerPublicLayout> {
      return read('getSeatMap', signal, () => {
        if (occurrenceId !== OCCURRENCE_ID) throw makeError('not_found', 'Occurrence not found');
        return publicLayout;
      });
    },
    getAvailability(occurrenceId: string, signal?: AbortSignal): Promise<BuyerAvailability> {
      return read('getAvailability', signal, () => {
        if (occurrenceId !== OCCURRENCE_ID) throw makeError('not_found', 'Occurrence not found');
        return buildAvailability();
      });
    },
    getPrices(occurrenceId: string, signal?: AbortSignal): Promise<BuyerPrices> {
      return read('getPrices', signal, () => {
        if (occurrenceId !== OCCURRENCE_ID) throw makeError('not_found', 'Occurrence not found');
        return buyerPricesSchema.parse({
          apiVersion: API_VERSION, occurrenceId, layoutVersionId: LAYOUT_VERSION_ID,
          pricingRevision, currency: CURRENCY,
          seats: { [SEAT_ID]: { amountMinor: seatPriceMinor, category: 'Партер' } },
          zones: { [ZONE_ID]: { amountMinor: zonePriceMinor } },
        });
      });
    },
    getChanges(occurrenceId: string, sinceRevision: number, signal?: AbortSignal): Promise<BuyerAvailabilityChanges> {
      return read('getChanges', signal, () => {
        if (occurrenceId !== OCCURRENCE_ID) throw makeError('not_found', 'Occurrence not found');
        if (!Number.isSafeInteger(sinceRevision) || sinceRevision < 0 || sinceRevision > availabilityRevision)
          throw makeError('validation_failed', 'Availability revision is outside the current range', availabilityRevision);
        return buyerAvailabilityChangesSchema.parse({
          apiVersion: API_VERSION, occurrenceId, layoutVersionId: LAYOUT_VERSION_ID,
          sinceRevision, currentRevision: availabilityRevision, serverTime: asIso(now()),
          resyncRequired: sinceRevision !== availabilityRevision, changes: [],
        });
      });
    },
    createHold(purchaseSessionId: string, occurrenceId: string, request: BuyerHoldRequest, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerHold> {
      return mutate('createHold', purchaseSessionId, idempotencyKey, { occurrenceId, request }, signal, () => {
        expireActiveHolds();
        const session = requireSession(purchaseSessionId);
        if (session.occurrenceId !== occurrenceId || occurrenceId !== OCCURRENCE_ID) throw makeError('not_found', 'Occurrence not found in this session');
        if (stalePriceBeforeFirstHold) {
          stalePriceBeforeFirstHold = false;
          pricingRevision += 1;
          zonePriceMinor = options.zonePriceAfterStaleMinor ?? zonePriceMinor + 500;
          seatPriceMinor = options.seatPriceAfterStaleMinor ?? seatPriceMinor + 500;
          throw makeError('price_changed', 'Prices changed. Refresh and confirm the total.', pricingRevision);
        }
        if (request.layoutVersionId !== LAYOUT_VERSION_ID) throw makeError('layout_version_conflict', 'The seat map changed');
        if (request.pricingRevision !== pricingRevision) throw makeError('price_changed', 'Prices changed. Refresh and confirm the total.', pricingRevision);
        if (request.availabilityRevision !== availabilityRevision) throw makeError('availability_conflict', 'Availability changed', availabilityRevision);
        if (request.selection.some((item) => item.kind === 'generalAdmission' &&
            (item.zoneId !== ZONE_ID || item.quantity > 8 || item.quantity > gaAvailable)))
          throw makeError('availability_conflict', 'Selected capacity is unavailable', availabilityRevision);
        if (request.selection.some((item) => item.kind === 'seat' &&
            (item.seatId !== SEAT_ID || buildAvailability().seats[SEAT_ID] !== 'available')))
          throw makeError('availability_conflict', 'Selected seat is unavailable', availabilityRevision);
        const existing = getHoldForSession(session);
        if (existing?.status === 'active') throw makeError('revision_conflict', 'This purchase session already has an active hold', existing.revision);
        const lineItems = lineItemsFor(request.selection);
        const totalMinor = lineItems.reduce((sum, item) => sum + item.totalMinor, 0);
        const hold = buyerHoldSchema.parse({
          apiVersion: API_VERSION, id: idFactory('hold'), ownerSessionId: purchaseSessionId,
          occurrenceId, layoutVersionId: LAYOUT_VERSION_ID, revision: 1,
          expiresAt: asIso(new Date(now().getTime() + holdDurationMs)), serverTime: asIso(now()),
          selection: request.selection, lineItems, totalMinor, currency: CURRENCY,
          availabilityRevision: availabilityRevision + 1, status: 'active',
        });
        request.selection.forEach((item) => { if (item.kind === 'generalAdmission') gaAvailable -= item.quantity; });
        availabilityRevision += 1;
        holds.set(hold.id, hold);
        session.holdId = hold.id;
        return hold;
      });
    },
    getHold(purchaseSessionId: string, holdId: string, signal?: AbortSignal): Promise<BuyerHold> {
      return read('getHold', signal, () => {
        const session = requireSession(purchaseSessionId);
        if (session.holdId !== holdId) throw makeError('not_found', 'Hold not found for this session');
        const hold = getHoldForSession(session);
        if (!hold) throw makeError('not_found', 'Hold not found');
        return hold;
      });
    },
    cancelHold(purchaseSessionId: string, holdId: string, expectedRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<void> {
      return mutate('cancelHold', purchaseSessionId, idempotencyKey, { holdId, expectedRevision }, signal, () => {
        const session = requireSession(purchaseSessionId);
        const hold = getHoldForSession(session);
        if (!hold || session.holdId !== holdId) throw makeError('not_found', 'Hold not found for this session');
        if (hold.revision !== expectedRevision) throw makeError('revision_conflict', 'Hold changed', hold.revision);
        if (hold.status === 'cancelled' || hold.status === 'expired') return;
        if (hold.status !== 'active') throw makeError('revision_conflict', 'Only an active hold can be cancelled', hold.revision);
        const cancelled = buyerHoldSchema.parse({ ...hold, revision: hold.revision + 1, status: 'cancelled', serverTime: asIso(now()) });
        holds.set(holdId, cancelled);
        hold.selection.forEach((item) => { if (item.kind === 'generalAdmission') gaAvailable += item.quantity; });
        availabilityRevision += 1;
        session.holdId = cancelled.id;
      });
    },
    saveContact(purchaseSessionId: string, contact: BuyerContact, contactRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseSessionContact> {
      return mutate('saveContact', purchaseSessionId, idempotencyKey, { contact, contactRevision }, signal, () => {
        const session = requireSession(purchaseSessionId);
        if (contactRevision !== session.contactRevision) throw makeError('revision_conflict', 'Contact changed', session.contactRevision);
        const checked = buyerContactSchema.parse(contact);
        const changedEmail = session.contact?.email !== checked.email;
        session.contact = checked;
        session.contactRevision += 1;
        if (changedEmail) session.emailVerification = { status: 'unverified', verifiedEmail: null };
        return buyerSessionContactSchema.parse({
          apiVersion: API_VERSION, contact: checked, contactRevision: session.contactRevision,
          emailVerification: session.emailVerification,
        });
      });
    },
    requestEmail(purchaseSessionId: string, email: string, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseEmailChallenge> {
      return mutate('requestEmail', purchaseSessionId, idempotencyKey, { email }, signal, () => {
        const session = requireSession(purchaseSessionId);
        if (!session.contact || session.contact.email !== email) throw makeError('validation_failed', 'Challenge email must match the current contact email');
        const challenge = {
          apiVersion: API_VERSION, challengeId: idFactory('challenge'),
          destinationMasked: email.replace(/^(.).+(@.+)$/, '$1***$2'), codeLength: otpCode.length,
          expiresAt: asIso(new Date(now().getTime() + 10 * 60 * 1_000)),
          resendAvailableAt: asIso(new Date(now().getTime() + 60 * 1_000)), attemptsRemaining: 5,
        } satisfies PurchaseEmailChallenge;
        challenges.set(challenge.challengeId, { ...challenge, purchaseSessionId, email });
        session.emailVerification = { status: 'pending', verifiedEmail: null };
        return challenge;
      });
    },
    verifyEmail(purchaseSessionId: string, challengeId: string, code: string, idempotencyKey: string, signal?: AbortSignal): Promise<PurchaseSessionContact> {
      return mutate('verifyEmail', purchaseSessionId, idempotencyKey, { challengeId, code }, signal, () => {
        const session = requireSession(purchaseSessionId);
        const challenge = challenges.get(challengeId);
        if (!challenge || challenge.purchaseSessionId !== purchaseSessionId) throw makeError('not_found', 'Challenge not found for this session');
        if (Date.parse(challenge.expiresAt) <= now().getTime()) throw makeError('code_expired', 'Verification code expired');
        if (challenge.attemptsRemaining <= 0) throw makeError('invalid_code', 'No verification attempts remain');
        if (code !== otpCode) {
          challenges.set(challengeId, { ...challenge, attemptsRemaining: challenge.attemptsRemaining - 1 });
          throw makeError('invalid_code', 'Verification code is incorrect');
        }
        session.emailVerification = { status: 'verified', verifiedEmail: challenge.email };
        return buyerSessionContactSchema.parse({
          apiVersion: API_VERSION, contact: session.contact,
          contactRevision: session.contactRevision, emailVerification: session.emailVerification,
        });
      });
    },
    createOrder(purchaseSessionId: string, holdId: string, contactRevision: number, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerOrder> {
      return mutate('createOrder', purchaseSessionId, idempotencyKey, { holdId, contactRevision }, signal, () => {
        const session = requireSession(purchaseSessionId);
        if (!session.contact) throw makeError('validation_failed', 'Buyer contact is required');
        if (session.contactRevision !== contactRevision) throw makeError('revision_conflict', 'Contact changed', session.contactRevision);
        if (session.holdId !== holdId) throw makeError('not_found', 'Hold not found for this session');
        const hold = getHoldForSession(session);
        if (!hold || hold.status !== 'active') throw makeError('hold_expired', 'An active hold is required');
        if (session.orderId) {
          const existingOrder = orders.get(session.orderId);
          if (existingOrder) return existingOrder;
          throw makeError('not_found', 'The current order is unavailable');
        }
        const order = buyerOrderSchema.parse({
          apiVersion: API_VERSION, id: idFactory('order'), occurrenceId: hold.occurrenceId,
          layoutVersionId: hold.layoutVersionId, revision: 1, holdId,
          quoteId: null, contactRevision, selection: hold.selection, lines: hold.lineItems,
          currency: hold.currency, status: 'pending', paymentStatus: 'not_started',
          ticketDeliveryStatus: 'pending', createdAt: asIso(now()),
        });
        const converted = buyerHoldSchema.parse({ ...hold, revision: hold.revision + 1, status: 'converted', serverTime: asIso(now()) });
        holds.set(holdId, converted);
        orders.set(order.id, order);
        session.orderId = order.id;
        return order;
      });
    },
    getOrder(purchaseSessionId: string, orderId: string, signal?: AbortSignal): Promise<BuyerOrder> {
      return read('getOrder', signal, () => requireOrder(purchaseSessionId, orderId));
    },
    createQuote(purchaseSessionId: string, orderId: string, orderRevision: number, promoCode: string | null | undefined, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerQuote> {
      return mutate('createQuote', purchaseSessionId, idempotencyKey, { orderId, orderRevision, promoCode }, signal, () => {
        const order = requireOrder(purchaseSessionId, orderId);
        if (order.revision !== orderRevision) throw makeError('revision_conflict', 'Order changed', order.revision);
        const hold = holds.get(order.holdId);
        if (!hold || hold.status !== 'converted') throw makeError('hold_expired', 'Order hold is unavailable');
        if (promoCode && promoCode.toUpperCase() !== 'SAVE10') throw makeError('invalid_promo', 'Promotion code is not valid');
        const ticketsSubtotalMinor = order.lines.reduce((total, line) => total + line.totalMinor, 0);
        const discountMinor = promoCode ? Math.floor(ticketsSubtotalMinor / 10) : 0;
        const quote = buyerQuoteSchema.parse({
          apiVersion: API_VERSION, quoteId: idFactory('quote'), orderId,
          revision: (quotes.get(orderId)?.revision ?? 0) + 1,
          expiresAt: asIso(new Date(now().getTime() + 5 * 60 * 1_000)), currency: order.currency,
          lines: order.lines, ticketsSubtotalMinor, discountMinor, serviceFeeMinor: 0,
          commissionMinor: 0, totalMinor: ticketsSubtotalMinor - discountMinor,
          promo: promoCode ? { status: 'applied', code: promoCode } : { status: 'none' },
        });
        const updatedOrder = buyerOrderSchema.parse({ ...order, revision: order.revision + 1, quoteId: quote.quoteId });
        orders.set(orderId, updatedOrder);
        quotes.set(orderId, quote);
        return quote;
      });
    },
    checkout(purchaseSessionId: string, orderId: string, request: { quoteId: string; quoteRevision: number; orderRevision: number }, idempotencyKey: string, signal?: AbortSignal): Promise<BuyerCheckoutResult> {
      return mutate('checkout', purchaseSessionId, idempotencyKey, { orderId, request }, signal, () => {
        const session = requireSession(purchaseSessionId);
        const order = requireOrder(purchaseSessionId, orderId);
        if (order.paymentStatus === 'pending' && session.paymentAttempt) return buyerCheckoutResultSchema.parse({ apiVersion: API_VERSION, order, paymentAttempt: session.paymentAttempt });
        if (order.revision !== request.orderRevision) throw makeError('revision_conflict', 'Order changed', order.revision);
        if (!session.contact || session.contactRevision !== order.contactRevision) throw makeError('revision_conflict', 'Contact changed', session.contactRevision);
        if (session.emailVerification?.status !== 'verified') throw makeError('verification_required', 'Verify the contact email before payment');
        const quote = quotes.get(orderId);
        if (!quote || quote.quoteId !== request.quoteId || quote.revision !== request.quoteRevision || order.quoteId !== request.quoteId)
          throw makeError('revision_conflict', 'Quote changed. Refresh and confirm the total.', order.revision);
        if (Date.parse(quote.expiresAt) <= now().getTime()) throw makeError('quote_expired', 'Quote expired. Create a new quote.');
        const paid = !pendingPayment;
        const finalOrder = buyerOrderSchema.parse({
          ...order, revision: order.revision + 1, status: paid ? 'confirmed' : 'payment_pending',
          paymentStatus: paid ? 'paid' : 'pending', ticketDeliveryStatus: 'pending',
        });
        const paymentId = idFactory('payment');
        const action = paid || paymentMode === 'none'
          ? { kind: 'none' as const }
          : paymentMode === 'native'
            ? { kind: 'native' as const, payload: { provider: 'demo-provider', values: { orderId } } }
            : { kind: 'redirect' as const, url: `https://payments.example.test/attempt/${paymentId}` };
        const paymentAttempt = {
          apiVersion: API_VERSION, id: paymentId, orderId,
          status: paid ? 'succeeded' : 'processing', action,
        } as const;
        orders.set(orderId, finalOrder);
        session.paymentAttempt = paymentAttempt;
        return buyerCheckoutResultSchema.parse({ apiVersion: API_VERSION, order: finalOrder, paymentAttempt });
      });
    },
    getTickets(purchaseSessionId: string, orderId: string, signal?: AbortSignal): Promise<BuyerTicketSummary[]> {
      return read('getTickets', signal, () => {
        const order = requireOrder(purchaseSessionId, orderId);
        if (!['confirmed', 'payment_pending'].includes(order.status)) return [];
        const items = order.lines.flatMap((line) => Array.from({ length: line.quantity }, (_, ticketIndex) => ({
          apiVersion: API_VERSION, ticketId: `${order.id}-ticket-${line.label}-${ticketIndex + 1}`,
          orderId, occurrenceId: order.occurrenceId,
          displayLabels: { eventTitle: 'Демо событие', occurrenceTitle: 'Демо сеанс',
            ...(line.label === 'A-1' ? { seat: line.label } : { zone: line.label }) },
          deliveryStatus: order.paymentStatus === 'paid' ? 'issued' as const : 'pending' as const,
          open: null,
        })));
        return buyerTicketListSchema.parse({ apiVersion: API_VERSION, items }).items;
      });
    },
  } satisfies PurchaseDataSource;
}

export type EmbedPurchaseDataSourceConfig = {
  readonly mode: 'production' | 'demo';
  readonly source?: PurchaseDataSource;
  readonly mockOptions?: MockPurchaseDataSourceOptions;
};

export function resolveEmbedPurchaseDataSource(config: EmbedPurchaseDataSourceConfig): PurchaseDataSource {
  if (config.source) return config.source;
  if (config.mode === 'demo') return createMockPurchaseDataSource(config.mockOptions);
  throw new PurchaseConfigurationError();
}

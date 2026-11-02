import type {
  BuyerAvailability,
  BuyerHold,
  BuyerOccurrenceSummary,
  BuyerSelection,
} from '@hall-platform/api-contracts';
import { BuyerApiError, mapV2BuyerPricesToSeatView } from '@hall-platform/api-axios';
import {
  applySeatAvailabilityDeltas,
  validateSelection,
  type PublishedHallLayout,
  type SeatSelectionItem,
} from '@hall-platform/seat-view';
import {
  calculateSelectionTotalMinor,
  loadPurchaseSnapshot,
  mapBuyerAvailabilityToSeatView,
  PurchaseSnapshotError,
  type PurchaseSnapshot,
} from './purchaseEffects.js';
import type { PurchaseDataSource } from './purchase.types.js';
import type { PurchaseSession } from './purchase.types.js';

export type PurchaseControllerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'submitting'
  | 'hold_retry_required'
  | 'price_confirmation_required'
  | 'confirm_occurrence_change'
  | 'reserved'
  | 'not_found'
  | 'sales_closed'
  | 'sold_out'
  | 'error';

export type PurchaseControllerSnapshot = Readonly<{
  status: PurchaseControllerStatus;
  eventId: string | null;
  purchaseSessionId: string | null;
  occurrences: readonly BuyerOccurrenceSummary[];
  occurrence: BuyerOccurrenceSummary | null;
  context: PurchaseSnapshot['context'] | null;
  layout: PurchaseSnapshot['layout'] | null;
  availability: PurchaseSnapshot['availability'] | null;
  prices: PurchaseSnapshot['prices'] | null;
  selection: readonly BuyerSelection[];
  hold: BuyerHold | null;
  totalMinor: number | null;
  serverTotalMinor: number | null;
  serverCurrency: string | null;
  pendingEventId: string | null;
  pendingOccurrenceId: string | null;
  unavailableSelection: readonly string[];
  /** null means a full snapshot is needed; [] means the current poll had no seat updates. */
  availabilityUpdatedSeatIds: readonly string[] | null;
  error: string | null;
  errorCode: string | null;
}>;

export type PurchaseActionResult =
  | { readonly kind: 'reserved'; readonly hold: BuyerHold }
  | { readonly kind: 'price_confirmation'; readonly totalMinor: number | null }
  | { readonly kind: 'invalid_selection'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export type PurchaseControllerOptions = Readonly<{
  idempotencyKey?: (operation: 'session' | 'hold' | 'cancel-hold') => string;
  hostBootstrapCredential?: string;
  initialSession?: Readonly<{ eventId: string; occurrenceId: string; purchaseSessionId: string }>;
  onSessionCreated?: (session: PurchaseSession) => void;
}>;

export type PurchaseController = Readonly<{
  getSnapshot: () => PurchaseControllerSnapshot;
  subscribe: (listener: () => void) => () => void;
  start: (eventId: string, occurrenceId: string) => Promise<void>;
  retry: () => Promise<void>;
  syncAvailability: () => Promise<void>;
  setSelection: (selection: readonly BuyerSelection[]) => void;
  selectOccurrence: (occurrenceId: string) => Promise<void>;
  releaseHoldForSelection: () => Promise<boolean>;
  cancelOccurrenceChange: () => void;
  confirmOccurrenceChange: () => Promise<void>;
  continue: () => Promise<PurchaseActionResult>;
  confirmServerTotal: () => PurchaseActionResult | Promise<PurchaseActionResult>;
  rejectServerTotal: () => Promise<void>;
  dispose: () => void;
}>;

const initialSnapshot: PurchaseControllerSnapshot = {
  status: 'idle',
  eventId: null,
  purchaseSessionId: null,
  occurrences: [],
  occurrence: null,
  context: null,
  layout: null,
  availability: null,
  prices: null,
  selection: [],
  hold: null,
  totalMinor: null,
  serverTotalMinor: null,
  serverCurrency: null,
  pendingEventId: null,
  pendingOccurrenceId: null,
  unavailableSelection: [],
  availabilityUpdatedSeatIds: null,
  error: null,
  errorCode: null,
};

let generatedKeySequence = 0;
function defaultIdempotencyKey(operation: string): string {
  generatedKeySequence += 1;
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}${generatedKeySequence}`;
  return `${operation}-${random}`;
}

function selectionKey(item: BuyerSelection): string {
  return item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`;
}

function selectionMatches(left: readonly BuyerSelection[], right: readonly BuyerSelection[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.kind === 'seat'
      ? other?.kind === 'seat' && item.seatId === other.seatId
      : other?.kind === 'generalAdmission' && item.zoneId === other.zoneId && item.quantity === other.quantity;
  });
}

function isPurchaseSession(value: { readonly purchaseSessionId: string }): value is PurchaseSession {
  return 'sessionCredential' in value
    && typeof value.sessionCredential === 'string'
    && 'expiresAt' in value
    && typeof value.expiresAt === 'string'
    && 'apiVersion' in value
    && value.apiVersion === 'v2';
}

function isNotFound(error: unknown): boolean {
  return (error instanceof BuyerApiError && error.code === 'not_found') ||
    (error instanceof PurchaseSnapshotError && error.code === 'not_found');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function holdOutcomeMayBeUncertain(error: unknown): boolean {
  if (!(error instanceof BuyerApiError)) return true;
  return [
    'network_error',
    'http_error',
    'invalid_response',
    'service_unavailable',
    'rate_limited',
    'cancelled',
  ].includes(error.code);
}

function unavailableSelection(
  snapshot: PurchaseSnapshot,
  selection: readonly BuyerSelection[],
): string[] {
  return selection.flatMap((item) => {
    if (item.kind === 'seat') {
      return snapshot.availability.seats[item.seatId] === 'available'
        ? []
        : [selectionKey(item)];
    }
    const zone = snapshot.availability.zones[item.zoneId];
    return !zone || zone.available < item.quantity ||
      (zone.maxPerOrder !== undefined && item.quantity > zone.maxPerOrder)
      ? [selectionKey(item)]
      : [];
  });
}

/** State machine for one buyer widget. All mutation and stale-response guards live here. */
export function createPurchaseController(
  dataSource: PurchaseDataSource,
  options: PurchaseControllerOptions = {},
): PurchaseController {
  const makeKey = options.idempotencyKey ?? defaultIdempotencyKey;
  const listeners = new Set<() => void>();
  let snapshot = initialSnapshot;
  let requestController: AbortController | null = null;
  let requestSequence = 0;
  let disposed = false;
  let pendingContinue: Promise<PurchaseActionResult> | null = null;
  let availabilitySyncController: AbortController | null = null;
  let pendingAvailabilitySync: Promise<void> | null = null;
  let holdKey: string | null = null;
  let lastStart: { eventId: string; occurrenceId: string } | null = null;
  const sessionKeys = new Map<string, string>();
  const sessionBindings = new Map<string, string>(options.initialSession
    ? [[`${options.initialSession.eventId}:${options.initialSession.occurrenceId}`, options.initialSession.purchaseSessionId]]
    : []);
  const reportedSessions = new Set<string>();
  const cancelHoldKeys = new Map<string, string>();
  const unreconciledHolds = new Map<string, { purchaseSessionId: string; occurrenceId: string }>();
  let availabilityIndexKey = '';
  let knownSeatIds = new Set<string>();
  let knownZoneIds = new Set<string>();

  const indexAvailabilityEntities = (layout: PurchaseSnapshot['layout']) => {
    const key = `${layout.snapshot.id}:${layout.snapshot.layoutVersionId}`;
    if (availabilityIndexKey === key) return;
    availabilityIndexKey = key;
    knownSeatIds = new Set(layout.snapshot.seats.map(({ id }) => id));
    knownZoneIds = new Set(layout.snapshot.zones.filter(({ kind }) => kind === 'ga').map(({ id }) => id));
  };

  const getSessionKey = (eventId: string, occurrenceId: string) => {
    const key = `${eventId}:${occurrenceId}`;
    const existing = sessionKeys.get(key);
    if (existing) return existing;
    const generated = makeKey('session');
    sessionKeys.set(key, generated);
    return generated;
  };
  const getCancelHoldKey = (holdId: string) => {
    const existing = cancelHoldKeys.get(holdId);
    if (existing) return existing;
    const generated = makeKey('cancel-hold');
    cancelHoldKeys.set(holdId, generated);
    return generated;
  };

  const publish = (next: PurchaseControllerSnapshot) => {
    if (disposed) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const patch = (changes: Partial<PurchaseControllerSnapshot>) => publish({ ...snapshot, ...changes });
  const abortPending = () => {
    requestController?.abort();
    requestController = null;
    availabilitySyncController?.abort();
    availabilitySyncController = null;
    pendingAvailabilitySync = null;
  };

  async function listAllOccurrences(eventId: string, signal: AbortSignal): Promise<BuyerOccurrenceSummary[]> {
    const items: BuyerOccurrenceSummary[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let hasMore = true;
    do {
      const page = await dataSource.listOccurrences(eventId, cursor, signal);
      for (const occurrence of page.items) {
        if (occurrence.eventId !== eventId) {
          throw new BuyerApiError('invalid_response', 'Occurrence list returned an item for another event');
        }
        if (!ids.has(occurrence.occurrenceId)) {
          items.push(occurrence);
          ids.add(occurrence.occurrenceId);
        }
      }
      hasMore = page.pagination.hasMore;
      cursor = page.pagination.nextCursor;
      if (hasMore && cursor === null) {
        throw new BuyerApiError('invalid_response', 'Occurrence pagination did not provide a next cursor');
      }
      if (hasMore && cursor !== null) {
        if (cursors.has(cursor)) throw new BuyerApiError('invalid_response', 'Occurrence pagination returned a repeated cursor');
        cursors.add(cursor);
      }
    } while (hasMore);
    return items;
  }

  function validationResult() {
    if (!snapshot.layout || !snapshot.availability || !snapshot.prices) return null;
    return validateSelection({
      layout: snapshot.layout as PublishedHallLayout,
      selection: snapshot.selection as readonly SeatSelectionItem[],
      availability: mapBuyerAvailabilityToSeatView(snapshot.availability),
      prices: mapV2BuyerPricesToSeatView(snapshot.prices),
      ...(snapshot.hold?.status === 'active'
        ? { ownHoldSelection: snapshot.hold.selection as readonly SeatSelectionItem[] }
        : {}),
      zoneIds: new Set(snapshot.layout.snapshot.zones.filter((zone) => zone.kind === 'ga').map((zone) => zone.id)),
    });
  }

  async function loadOccurrence(eventId: string, occurrenceId: string): Promise<void> {
    abortPending();
    requestController = new AbortController();
    const controller = requestController;
    const sequence = ++requestSequence;
    lastStart = { eventId, occurrenceId };
    holdKey = null;
    pendingContinue = null;
    publish({
      ...initialSnapshot,
      status: 'loading',
      eventId,
      occurrence: snapshot.occurrences.find((item) => item.occurrenceId === occurrenceId) ?? null,
      occurrences: snapshot.eventId === eventId ? snapshot.occurrences : [],
    });

    try {
      const bindingKey = `${eventId}:${occurrenceId}`;
      const existingSessionId = sessionBindings.get(bindingKey);
      const [occurrences, session] = await Promise.all([
        listAllOccurrences(eventId, controller.signal),
        existingSessionId
          ? Promise.resolve({ purchaseSessionId: existingSessionId })
          : dataSource.createSession({
            occurrenceId,
            ...(options.hostBootstrapCredential ? { hostBootstrapCredential: options.hostBootstrapCredential } : {}),
          }, getSessionKey(eventId, occurrenceId), controller.signal),
      ]);
      sessionBindings.set(bindingKey, session.purchaseSessionId);
      sessionKeys.delete(`${eventId}:${occurrenceId}`);
      if (disposed || sequence !== requestSequence || controller.signal.aborted) return;
      if (!existingSessionId && isPurchaseSession(session) && !reportedSessions.has(session.purchaseSessionId)) {
        reportedSessions.add(session.purchaseSessionId);
        try {
          options.onSessionCreated?.(session);
        } catch {
          // The host notification is best effort; the in-memory source still owns the active credential.
        }
      }
      const occurrence = occurrences.find((item) => item.occurrenceId === occurrenceId);
      if (!occurrence) {
        publish({ ...snapshot, status: 'not_found', occurrences, occurrence: null, error: 'The selected event time was not found', errorCode: 'not_found' });
        return;
      }
      publish({
        ...snapshot,
        status: 'loading',
        eventId,
        purchaseSessionId: session.purchaseSessionId,
        occurrences,
        occurrence,
        error: null,
        errorCode: null,
      });
      const purchaseSnapshot = await loadPurchaseSnapshot(dataSource, session.purchaseSessionId, occurrenceId, controller.signal, eventId);
      if (disposed || sequence !== requestSequence || controller.signal.aborted) return;
      indexAvailabilityEntities(purchaseSnapshot.layout);
      const currentOccurrence = purchaseSnapshot.context.summary;
      try {
        new Intl.DateTimeFormat('en', { timeZone: currentOccurrence.timeZone });
      } catch {
        throw new BuyerApiError('invalid_response', 'The event timezone is not valid');
      }
      const ownHold = purchaseSnapshot.context.ownHold;
      for (const [holdId, binding] of unreconciledHolds) {
        if (binding.purchaseSessionId === session.purchaseSessionId && binding.occurrenceId === occurrenceId) {
          unreconciledHolds.delete(holdId);
        }
      }
      if (ownHold?.status === 'active' && ownHold.currency !== purchaseSnapshot.prices.currency) {
        try {
          await releaseAndReconcileHold(session.purchaseSessionId, ownHold);
        } catch (releaseError) {
          publish({
            ...snapshot,
            status: 'error',
            purchaseSessionId: session.purchaseSessionId,
            occurrences,
            occurrence: currentOccurrence,
            ...purchaseSnapshot,
            selection: ownHold.selection,
            hold: ownHold,
            totalMinor: calculateSelectionTotalMinor(purchaseSnapshot.prices, ownHold.selection),
            error: `The active reservation uses ${ownHold.currency}, but this event uses ${purchaseSnapshot.prices.currency}. Could not release the reservation: ${errorMessage(releaseError)}`,
            errorCode: 'currency_mismatch',
          });
          return;
        }
        publish({
          ...snapshot,
          status: 'error',
          purchaseSessionId: session.purchaseSessionId,
          occurrences,
          occurrence: currentOccurrence,
          ...purchaseSnapshot,
          selection: [],
          hold: null,
          totalMinor: null,
          error: `The active reservation used ${ownHold.currency}, but this event uses ${purchaseSnapshot.prices.currency}. The reservation was released. Refresh to continue.`,
          errorCode: 'currency_mismatch',
        });
        return;
      }
      const status = ownHold?.status === 'active'
        ? 'reserved'
        : currentOccurrence.salesStatus === 'sold_out'
          ? 'sold_out'
          : currentOccurrence.salesStatus === 'open'
            ? 'ready'
            : 'sales_closed';
      const nextSelection = ownHold?.status === 'active' ? ownHold.selection : [];
      publish({
        status,
        eventId,
        purchaseSessionId: session.purchaseSessionId,
        occurrences,
        occurrence: currentOccurrence,
        ...purchaseSnapshot,
        selection: nextSelection,
        hold: ownHold,
        totalMinor: calculateSelectionTotalMinor(purchaseSnapshot.prices, nextSelection),
        serverTotalMinor: null,
        serverCurrency: null,
        pendingEventId: null,
        pendingOccurrenceId: null,
        unavailableSelection: [],
        availabilityUpdatedSeatIds: null,
        error: null,
        errorCode: null,
      });
    } catch (error) {
      if (disposed || sequence !== requestSequence || controller.signal.aborted) return;
      const status = isNotFound(error) ? 'not_found' : 'error';
      publish({
        ...snapshot,
        status,
        error: errorMessage(error),
        errorCode: error instanceof BuyerApiError ? error.code : error instanceof PurchaseSnapshotError ? error.code : 'network_error',
      });
    }
  }

  async function start(eventId: string, occurrenceId: string): Promise<void> {
    if (
      snapshot.hold?.status === 'active' &&
      (eventId !== snapshot.eventId || occurrenceId !== snapshot.occurrence?.occurrenceId)
    ) {
      patch({
        status: 'confirm_occurrence_change',
        pendingEventId: eventId,
        pendingOccurrenceId: occurrenceId,
        error: null,
        errorCode: null,
      });
      return;
    }
    await loadOccurrence(eventId, occurrenceId);
  }

  async function retry(): Promise<void> {
    if (lastStart) await loadOccurrence(lastStart.eventId, lastStart.occurrenceId);
  }

  async function syncAvailability(): Promise<void> {
    if (pendingAvailabilitySync) return pendingAvailabilitySync;
    const current = snapshot;
    const sessionId = current.purchaseSessionId;
    const occurrenceId = current.occurrence?.occurrenceId;
    const eventId = current.eventId;
    const layout = current.layout;
    const availability = current.availability;
    const prices = current.prices;
    if (disposed || current.status !== 'ready' || !sessionId || !occurrenceId || !eventId ||
        !layout || !availability || !prices) return;

    const requestSequenceAtStart = requestSequence;
    const controller = new AbortController();
    availabilitySyncController = controller;
    const isCurrent = () => !disposed && !controller.signal.aborted &&
      requestSequenceAtStart === requestSequence &&
      snapshot.purchaseSessionId === sessionId &&
      snapshot.occurrence?.occurrenceId === occurrenceId &&
      snapshot.layout?.snapshot.layoutVersionId === layout.snapshot.layoutVersionId;

    const syncPromise = (async () => {
      const [changes, context] = await Promise.all([
        dataSource.getChanges(occurrenceId, availability.revision, controller.signal),
        dataSource.getContext(sessionId, occurrenceId, controller.signal),
      ]);
      if (!isCurrent()) return;
      if (changes.occurrenceId !== occurrenceId || changes.layoutVersionId !== layout.snapshot.layoutVersionId ||
          changes.sinceRevision !== availability.revision || context.summary.occurrenceId !== occurrenceId ||
          context.summary.eventId !== eventId) {
        throw new BuyerApiError('invalid_response', 'Availability update belongs to another purchase context');
      }
      if (context.layoutVersionId !== layout.snapshot.layoutVersionId) {
        await retry();
        return;
      }
      if (context.availabilityRevision < availability.revision || context.pricingRevision < prices.pricingRevision) {
        // A replica can briefly return an older context. Leave the current state intact and retry on the next poll.
        return;
      }

      indexAvailabilityEntities(layout);
      let nextAvailability: BuyerAvailability;
      let updatedSeatIds: readonly string[] | null;
      if (changes.resyncRequired || changes.currentRevision !== context.availabilityRevision) {
        const full = await dataSource.getAvailability(occurrenceId, controller.signal);
        if (!isCurrent()) return;
        if (full.occurrenceId !== occurrenceId || full.layoutVersionId !== layout.snapshot.layoutVersionId ||
            full.revision !== context.availabilityRevision) {
          throw new BuyerApiError('invalid_response', 'Availability resync did not match the current revision');
        }
        nextAvailability = full;
        updatedSeatIds = null;
      } else {
        const deltaSeats = new Set(changes.changes.flatMap((change) => Object.keys(change.seats ?? {})));
        const deltaZones = new Set(changes.changes.flatMap((change) => Object.keys(change.zones ?? {})));
        if ([...deltaSeats].some((id) => !knownSeatIds.has(id)) || [...deltaZones].some((id) => !knownZoneIds.has(id))) {
          const full = await dataSource.getAvailability(occurrenceId, controller.signal);
          if (!isCurrent()) return;
          if (full.occurrenceId !== occurrenceId || full.layoutVersionId !== layout.snapshot.layoutVersionId ||
              full.revision !== context.availabilityRevision) {
            throw new BuyerApiError('invalid_response', 'Availability resync did not match the current revision');
          }
          nextAvailability = full;
          updatedSeatIds = null;
        } else {
          const applied = applySeatAvailabilityDeltas(
            mapBuyerAvailabilityToSeatView(availability),
            availability.revision,
            changes.changes.map((change) => ({
              baseRevision: change.baseRevision,
              revision: change.revision,
              ...(change.seats === undefined ? {} : { seats: change.seats }),
              ...(change.zones === undefined ? {} : {
                zones: Object.fromEntries(Object.entries(change.zones).map(([id, zone]) => [
                  id,
                  zone === null ? null : {
                    available: zone.available,
                    ...(zone.maxPerOrder === undefined ? {} : { maxPerOrder: zone.maxPerOrder }),
                  },
                ])),
              }),
            })),
          );
          if (applied.resyncRequired || applied.revision !== context.availabilityRevision) {
            const full = await dataSource.getAvailability(occurrenceId, controller.signal);
            if (!isCurrent()) return;
            if (full.occurrenceId !== occurrenceId || full.layoutVersionId !== layout.snapshot.layoutVersionId ||
                full.revision !== context.availabilityRevision) {
              throw new BuyerApiError('invalid_response', 'Availability resync did not match the current revision');
            }
            nextAvailability = full;
            updatedSeatIds = null;
          } else {
            nextAvailability = {
              ...availability,
              revision: applied.revision,
              serverTime: changes.serverTime,
              seats: applied.availability.seats,
              zones: applied.availability.zones ?? availability.zones,
            };
            updatedSeatIds = [...deltaSeats];
          }
        }
      }

      let nextPrices = prices;
      if (context.pricingRevision > prices.pricingRevision) {
        nextPrices = await dataSource.getPrices(occurrenceId, controller.signal);
        if (!isCurrent()) return;
        if (nextPrices.occurrenceId !== occurrenceId || nextPrices.layoutVersionId !== layout.snapshot.layoutVersionId ||
            nextPrices.pricingRevision !== context.pricingRevision || nextPrices.currency !== context.summary.currency) {
          throw new BuyerApiError('invalid_response', 'Price update does not match the current purchase context');
        }
      }
      if (!isCurrent()) return;
      patch({
        context,
        occurrence: context.summary,
        availability: nextAvailability,
        prices: nextPrices,
        availabilityUpdatedSeatIds: updatedSeatIds,
        totalMinor: calculateSelectionTotalMinor(nextPrices, snapshot.selection),
      });
    })().finally(() => {
      if (availabilitySyncController === controller) {
        availabilitySyncController = null;
        pendingAvailabilitySync = null;
      }
    });
    pendingAvailabilitySync = syncPromise;
    return syncPromise;
  }

  function setSelection(selection: readonly BuyerSelection[]): void {
    if (disposed || snapshot.status !== 'ready' || snapshot.hold?.status === 'active') return;
    const currentSnapshot = snapshot;
    const next = [...selection];
    const totalMinor = currentSnapshot.prices
      ? calculateSelectionTotalMinor(currentSnapshot.prices, next)
      : null;
    patch({ selection: next, totalMinor, serverTotalMinor: null, serverCurrency: null, unavailableSelection: [], availabilityUpdatedSeatIds: [], error: null, errorCode: null });
    holdKey = null;
  }

  async function selectOccurrence(occurrenceId: string): Promise<void> {
    if (disposed || !snapshot.eventId || !occurrenceId || occurrenceId === snapshot.occurrence?.occurrenceId) return;
    if (snapshot.status === 'submitting' || snapshot.status === 'hold_retry_required' || snapshot.status === 'price_confirmation_required') return;
    if (!snapshot.occurrences.some((item) => item.occurrenceId === occurrenceId)) {
      patch({ status: 'not_found', error: 'The selected event time was not found', errorCode: 'not_found' });
      return;
    }
    if (snapshot.hold?.status === 'active') {
      patch({ status: 'confirm_occurrence_change', pendingEventId: snapshot.eventId, pendingOccurrenceId: occurrenceId, error: null, errorCode: null });
      return;
    }
    await loadOccurrence(snapshot.eventId, occurrenceId);
  }

  async function releaseHoldForSelection(): Promise<boolean> {
    const hold = snapshot.hold;
    const sessionId = snapshot.purchaseSessionId;
    if (hold?.status === 'active' && sessionId) {
      try {
        await releaseAndReconcileHold(sessionId, hold);
      } catch (error) {
        const unknown = unreconciledHolds.has(hold.id);
        patch({
          status: unknown ? 'error' : 'reserved',
          hold: unknown ? null : hold,
          error: errorMessage(error),
          errorCode: unknown ? 'hold_state_unknown' : error instanceof BuyerApiError ? error.code : 'cancel_failed',
        });
        return false;
      }
    }
    holdKey = null;
    patch({
      status: 'ready', selection: [], hold: null, totalMinor: null, serverTotalMinor: null,
      serverCurrency: null, error: null, errorCode: null,
    });
    return true;
  }

  async function confirmOccurrenceChange(): Promise<void> {
    const occurrenceId = snapshot.pendingOccurrenceId;
    const hold = snapshot.hold;
    const eventId = snapshot.pendingEventId ?? snapshot.eventId;
    const sessionId = snapshot.purchaseSessionId;
    if (!occurrenceId || !eventId || !sessionId) return;

    try {
      if (hold?.status === 'active') await releaseAndReconcileHold(sessionId, hold);
      patch({ selection: [], hold: null, pendingEventId: null, pendingOccurrenceId: null });
      await loadOccurrence(eventId, occurrenceId);
    } catch (error) {
      if (hold && unreconciledHolds.has(hold.id)) {
        patch({
          status: 'error', hold: null, selection: [], pendingEventId: null, pendingOccurrenceId: null,
          error: errorMessage(error), errorCode: 'hold_state_unknown',
        });
        return;
      }
      patch({
        status: 'confirm_occurrence_change',
        error: errorMessage(error),
        errorCode: error instanceof BuyerApiError ? error.code : 'cancel_failed',
      });
    }
  }

  function cancelOccurrenceChange(): void {
    if (snapshot.status !== 'confirm_occurrence_change') return;
    if (snapshot.hold && unreconciledHolds.has(snapshot.hold.id)) {
      patch({
        status: 'error', hold: null, selection: [], pendingEventId: null, pendingOccurrenceId: null, errorCode: 'hold_state_unknown',
        error: snapshot.error ?? 'Reservation status could not be confirmed. Reload before continuing.',
      });
      return;
    }
    patch({
      status: snapshot.hold?.status === 'active' ? 'reserved' : 'ready',
      pendingEventId: null,
      pendingOccurrenceId: null,
      error: null,
      errorCode: null,
    });
  }

  async function releaseAndReconcileHold(sessionId: string, hold: BuyerHold): Promise<void> {
    let cancelFailure: unknown;
    try {
      await dataSource.cancelHold(sessionId, hold.id, hold.revision, getCancelHoldKey(hold.id));
    } catch (error) {
      cancelFailure = error;
    }
    let reconciled: BuyerHold;
    try {
      reconciled = await dataSource.getHold(sessionId, hold.id);
    } catch (error) {
      if (isNotFound(error)) {
        unreconciledHolds.delete(hold.id);
        cancelHoldKeys.delete(hold.id);
        return;
      }
      unreconciledHolds.set(hold.id, { purchaseSessionId: sessionId, occurrenceId: hold.occurrenceId });
      throw error;
    }
    unreconciledHolds.delete(hold.id);
    if (reconciled.status === 'active' || reconciled.status === 'converted') {
      throw cancelFailure ?? new BuyerApiError('revision_conflict', 'The existing reservation could not be released');
    }
    cancelHoldKeys.delete(hold.id);
  }

  async function refreshAfterConflict(
    sessionId: string,
    occurrenceId: string,
    sequence: number,
  ): Promise<PurchaseActionResult> {
    const controller = new AbortController();
    requestController?.abort();
    requestController = controller;
    try {
      const refreshed = await loadPurchaseSnapshot(dataSource, sessionId, occurrenceId, controller.signal, snapshot.eventId ?? undefined);
      if (disposed || sequence !== requestSequence || controller.signal.aborted) {
        return { kind: 'error', message: 'Purchase context changed' };
      }
      const invalid = unavailableSelection(refreshed, snapshot.selection);
      const refreshedValidation = validateSelection({
        layout: refreshed.layout as PublishedHallLayout,
        selection: snapshot.selection as readonly SeatSelectionItem[],
        availability: mapBuyerAvailabilityToSeatView(refreshed.availability),
        prices: mapV2BuyerPricesToSeatView(refreshed.prices),
        zoneIds: new Set(refreshed.layout.snapshot.zones.filter((zone) => zone.kind === 'ga').map((zone) => zone.id)),
      });
      const invalidKeys = new Set(invalid);
      for (const issue of refreshedValidation.issues) {
        if (issue.kind && issue.id) invalidKeys.add(`${issue.kind === 'seat' ? 'seat' : 'zone'}:${issue.id}`);
      }
      const unavailable = [...invalidKeys];
      holdKey = null;
      publish({
        ...snapshot,
        status: 'ready',
        ...refreshed,
        occurrence: refreshed.context.summary,
        availabilityUpdatedSeatIds: null,
        totalMinor: calculateSelectionTotalMinor(refreshed.prices, snapshot.selection),
        unavailableSelection: unavailable,
        error: unavailable.length ? 'Some selected tickets are no longer available. Update your selection to continue.' : 'Availability changed. Review the current selection and try again.',
        errorCode: 'availability_conflict',
      });
      return unavailable.length
        ? { kind: 'unavailable', message: 'Some selected tickets are no longer available' }
        : { kind: 'error', message: 'Availability changed. Review the current selection and try again.' };
    } catch (error) {
      if (disposed || sequence !== requestSequence || controller.signal.aborted) return { kind: 'error', message: 'Purchase context changed' };
      patch({ status: 'error', error: errorMessage(error), errorCode: 'network_error' });
      return { kind: 'error', message: errorMessage(error) };
    }
  }

  async function performContinue(): Promise<PurchaseActionResult> {
    const current = snapshot;
    const sessionId = current.purchaseSessionId;
    const occurrenceId = current.occurrence?.occurrenceId;
    const context = current.context;
    if (!sessionId || !occurrenceId || !context || !current.layout || !current.availability || !current.prices) {
      return { kind: 'error', message: 'Purchase data is not ready' };
    }
    if (current.unavailableSelection.length > 0) {
      return { kind: 'unavailable', message: 'Some selected tickets are no longer available' };
    }
    const validation = validationResult();
    if (!validation?.valid || !validation.total) {
      const message = validation?.issues.some(({ code }) => code === 'empty_selection')
        ? 'Choose at least one ticket to continue'
        : 'Review ticket availability, quantity, and price before continuing';
      return { kind: 'invalid_selection', message };
    }

    const sequence = requestSequence;
    const controller = requestController ?? new AbortController();
    requestController = controller;
    patch({ status: 'submitting', error: null, errorCode: null });
    const key = holdKey ?? makeKey('hold');
    holdKey = key;
    try {
      const hold = await dataSource.createHold(sessionId, occurrenceId, {
        apiVersion: 'v2',
        layoutVersionId: current.layout.snapshot.layoutVersionId,
        availabilityRevision: current.availability.revision,
        pricingRevision: current.prices.pricingRevision,
        selection: [...current.selection],
      }, key, controller.signal);
      if (disposed || sequence !== requestSequence || controller.signal.aborted) {
        return { kind: 'error', message: 'Purchase context changed' };
      }
      if (hold.ownerSessionId !== sessionId || hold.occurrenceId !== occurrenceId ||
          hold.layoutVersionId !== current.layout.snapshot.layoutVersionId ||
          !selectionMatches(hold.selection, current.selection)) {
        throw new BuyerApiError('invalid_response', 'The reservation does not match the current purchase selection');
      }
      holdKey = null;
      if (hold.currency !== validation.total.currency) {
        try {
          await releaseAndReconcileHold(sessionId, hold);
          patch({
            status: 'error',
            hold: null,
            selection: [],
            totalMinor: null,
            serverTotalMinor: null,
            serverCurrency: null,
            error: `The server returned a reservation in ${hold.currency}, but the selected tickets use ${validation.total.currency}. The reservation was released. Refresh to continue.`,
            errorCode: 'currency_mismatch',
          });
          return { kind: 'error', message: 'The reservation currency does not match the selected tickets' };
        } catch (releaseError) {
          patch({
            status: 'price_confirmation_required',
            hold,
            serverTotalMinor: hold.totalMinor,
            serverCurrency: hold.currency,
            error: `The reservation uses ${hold.currency}, but the selected tickets use ${validation.total.currency}. It could not be released: ${errorMessage(releaseError)}`,
            errorCode: 'currency_mismatch',
          });
          return { kind: 'error', message: 'The reservation currency does not match the selected tickets' };
        }
      }
      if (hold.totalMinor !== validation.total.minorUnits) {
        patch({
          status: 'price_confirmation_required',
          hold,
          serverTotalMinor: hold.totalMinor,
          serverCurrency: hold.currency,
          error: null,
          errorCode: 'price_changed',
        });
        return { kind: 'price_confirmation', totalMinor: hold.totalMinor };
      }
      patch({ status: 'reserved', hold, serverTotalMinor: hold.totalMinor, serverCurrency: hold.currency, error: null, errorCode: null });
      return { kind: 'reserved', hold };
    } catch (error) {
      if (disposed || sequence !== requestSequence || controller.signal.aborted) return { kind: 'error', message: 'Purchase context changed' };
      if (error instanceof BuyerApiError && error.code === 'price_changed') {
        holdKey = null;
        try {
          const refreshed = await loadPurchaseSnapshot(dataSource, sessionId, occurrenceId, controller.signal, current.eventId ?? undefined);
          if (disposed || sequence !== requestSequence || controller.signal.aborted) return { kind: 'error', message: 'Purchase context changed' };
          const refreshedTotal = calculateSelectionTotalMinor(refreshed.prices, current.selection);
          publish({
            ...snapshot,
            status: 'price_confirmation_required',
            ...refreshed,
            occurrence: refreshed.context.summary,
            totalMinor: refreshedTotal,
            serverTotalMinor: refreshedTotal,
            serverCurrency: refreshed.prices.currency,
            error: 'Ticket prices changed. Confirm the updated total before reserving.',
            errorCode: 'price_changed',
          });
          return { kind: 'price_confirmation', totalMinor: refreshedTotal };
        } catch (refreshError) {
          if (disposed || sequence !== requestSequence || controller.signal.aborted) return { kind: 'error', message: 'Purchase context changed' };
          patch({ status: 'ready', error: errorMessage(refreshError), errorCode: 'network_error' });
          return { kind: 'error', message: errorMessage(refreshError) };
        }
      }
      if (error instanceof BuyerApiError && [
        'availability_conflict',
        'revision_conflict',
        'layout_version_conflict',
      ].includes(error.code)) {
        return refreshAfterConflict(sessionId, occurrenceId, sequence);
      }
      if (error instanceof BuyerApiError && error.code === 'sales_closed') {
        patch({ status: 'sales_closed', error: error.message, errorCode: error.code });
        return { kind: 'error', message: error.message };
      }
      patch({
        status: holdOutcomeMayBeUncertain(error) ? 'hold_retry_required' : 'ready',
        error: errorMessage(error),
        errorCode: error instanceof BuyerApiError ? error.code : 'network_error',
      });
      return { kind: 'error', message: errorMessage(error) };
    }
  }

  function continuePurchase(): Promise<PurchaseActionResult> {
    if (pendingContinue) return pendingContinue;
    if (snapshot.hold && unreconciledHolds.has(snapshot.hold.id)) {
      return Promise.resolve({ kind: 'error', message: 'The reservation status must be confirmed before continuing' });
    }
    if (snapshot.errorCode === 'currency_mismatch' || snapshot.errorCode === 'hold_state_unknown') {
      return Promise.resolve({ kind: 'error', message: snapshot.errorCode === 'currency_mismatch'
        ? 'The reservation currency does not match the selected tickets'
        : 'The reservation status must be confirmed before continuing' });
    }
    if (snapshot.hold?.status === 'active') {
      const hold = snapshot.hold;
      patch({ status: 'reserved', serverTotalMinor: hold.totalMinor, serverCurrency: hold.currency, error: null, errorCode: null });
      return Promise.resolve({ kind: 'reserved', hold });
    }
    if (snapshot.status !== 'ready' && snapshot.status !== 'hold_retry_required') {
      return Promise.resolve({ kind: 'error', message: 'Purchase data is not ready' });
    }
    pendingContinue = performContinue().finally(() => { pendingContinue = null; });
    return pendingContinue;
  }

  function confirmServerTotal(): PurchaseActionResult | Promise<PurchaseActionResult> {
    if (snapshot.status !== 'price_confirmation_required') {
      return { kind: 'error', message: 'There is no updated total to confirm' };
    }
    if (snapshot.errorCode === 'currency_mismatch' || snapshot.errorCode === 'hold_state_unknown') {
      return { kind: 'error', message: snapshot.errorCode === 'currency_mismatch'
        ? 'The reservation currency does not match the selected tickets'
        : 'The reservation status must be confirmed before continuing' };
    }
    if (snapshot.hold && unreconciledHolds.has(snapshot.hold.id)) {
      return { kind: 'error', message: 'The reservation status must be confirmed before continuing' };
    }
    if (snapshot.hold?.status === 'active') {
      const hold = snapshot.hold;
      patch({ status: 'reserved', serverCurrency: hold.currency, error: null, errorCode: null });
      return { kind: 'reserved', hold };
    }
    patch({ status: 'ready', error: null, errorCode: null });
    return continuePurchase();
  }

  async function rejectServerTotal(): Promise<void> {
    if (snapshot.status !== 'price_confirmation_required') return;
    const hold = snapshot.hold;
    const sessionId = snapshot.purchaseSessionId;
    if (hold?.status === 'active' && sessionId) {
      try {
        await releaseAndReconcileHold(sessionId, hold);
      } catch (error) {
        patch({
          error: errorMessage(error),
          errorCode: snapshot.errorCode === 'currency_mismatch'
            ? 'currency_mismatch'
            : hold && unreconciledHolds.has(hold.id) ? 'hold_state_unknown'
            : error instanceof BuyerApiError ? error.code : 'cancel_failed',
        });
        return;
      }
    }
    patch({ status: 'ready', selection: [], hold: null, totalMinor: null, serverTotalMinor: null, serverCurrency: null, error: null, errorCode: null });
    holdKey = null;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    retry,
    syncAvailability,
    setSelection,
    selectOccurrence,
    releaseHoldForSelection,
    cancelOccurrenceChange,
    confirmOccurrenceChange,
    continue: continuePurchase,
    confirmServerTotal,
    rejectServerTotal,
    dispose() {
      if (disposed) return;
      disposed = true;
      abortPending();
      sessionKeys.clear();
      sessionBindings.clear();
      cancelHoldKeys.clear();
      holdKey = null;
      listeners.clear();
    },
  };
}

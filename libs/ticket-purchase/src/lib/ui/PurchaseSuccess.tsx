import { useEffect, useState } from 'react';
import type { BuyerOrder, BuyerTicketSummary } from '@hall-platform/api-contracts';
import { BuyerApiError } from '@hall-platform/api-axios';
import { Button } from '@hall-platform/ui';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';
import { useTicketPurchaseController } from '../model/useTicketPurchase.js';
import { PurchaseLayout } from './PurchaseLayout.js';

export type PurchaseSuccessProps = Readonly<{
  order: BuyerOrder;
  className?: string;
}>;

type TicketLoadState = Readonly<{
  key: string;
  tickets: readonly BuyerTicketSummary[];
  deliveryStatus: BuyerOrder['ticketDeliveryStatus'];
  loading: boolean;
  error: string | null;
}>;

function failureMessage(error: unknown, english: boolean): string {
  if (error instanceof BuyerApiError && error.code === 'not_found') {
    return english ? 'The server has not prepared ticket details yet.' : 'Сервер ещё не подготовил данные билетов.';
  }
  return error instanceof Error
    ? error.message
    : english ? 'Could not load your tickets.' : 'Не удалось загрузить билеты.';
}

/** Shows success only for a paid, server-confirmed order and opens only issued tickets. */
export function PurchaseSuccess({ order, className = '' }: PurchaseSuccessProps) {
  const purchase = useTicketPurchase();
  const { snapshot } = useTicketPurchaseController();
  const sessionId = snapshot.purchaseSessionId;
  const occurrenceId = snapshot.occurrence?.occurrenceId;
  const english = purchase.locale.toLowerCase().startsWith('en');
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const isConfirmed = order.status === 'confirmed' && order.paymentStatus === 'paid';
  const loadKey = `${sessionId ?? 'missing-session'}:${order.id}:${refreshAttempt}`;
  const [loadState, setLoadState] = useState<TicketLoadState>({
    key: '', tickets: [], deliveryStatus: order.ticketDeliveryStatus, loading: true, error: null,
  });
  const currentLoad = loadState.key === loadKey
    ? loadState
    : {
      key: loadKey,
      tickets: [] as readonly BuyerTicketSummary[],
      deliveryStatus: order.ticketDeliveryStatus,
      loading: isConfirmed && Boolean(sessionId),
      error: isConfirmed && !sessionId
        ? english ? 'The purchase session could not be restored.' : 'Не удалось восстановить сессию покупки.'
        : null,
    };
  const { tickets, deliveryStatus, loading, error } = currentLoad;

  useEffect(() => {
    if (!sessionId || !isConfirmed) return;
    const request = new AbortController();
    let active = true;
    let pollTimer: number | null = null;
    void Promise.all([
      purchase.dataSource.getOrder(sessionId, order.id, request.signal),
      purchase.dataSource.getTickets(sessionId, order.id, request.signal),
    ]).then(([latestOrder, items]) => {
      if (!active || request.signal.aborted) return;
      if (latestOrder.id !== order.id || (occurrenceId && latestOrder.occurrenceId !== occurrenceId)) {
        throw new BuyerApiError('invalid_response', 'The refreshed order belongs to another event time');
      }
      if (items.some((ticket) => ticket.orderId !== order.id || (occurrenceId && ticket.occurrenceId !== occurrenceId))) {
        throw new BuyerApiError('invalid_response', 'Ticket list contains a ticket for another order or event time');
      }
      setLoadState({ key: loadKey, tickets: items, deliveryStatus: latestOrder.ticketDeliveryStatus, loading: false, error: null });
      const stillPreparing = latestOrder.ticketDeliveryStatus === 'pending' || latestOrder.ticketDeliveryStatus === 'partial' || items.some((ticket) => ticket.deliveryStatus === 'pending');
      if (stillPreparing) {
        pollTimer = window.setTimeout(() => setRefreshAttempt((attempt) => attempt + 1), 5_000);
      }
    }).catch((cause: unknown) => {
      if (!active || request.signal.aborted) return;
      setLoadState({ key: loadKey, tickets: [], deliveryStatus: order.ticketDeliveryStatus, loading: false, error: failureMessage(cause, english) });
    });
    return () => {
      active = false;
      request.abort();
      if (pollTimer !== null) window.clearTimeout(pollTimer);
    };
  }, [english, isConfirmed, loadKey, occurrenceId, order.id, order.ticketDeliveryStatus, purchase.dataSource, sessionId]);

  async function openTickets() {
    const ticketIds = tickets
      .filter((ticket) => ticket.deliveryStatus === 'issued' && ticket.open !== null)
      .map((ticket) => ticket.ticketId);
    if (ticketIds.length === 0 || !purchase.hostActions.onTickets) return;
    setActionError(null);
    try {
      await purchase.hostActions.onTickets(ticketIds);
    } catch (cause) {
      setActionError(failureMessage(cause, english));
    }
  }

  const issuedTicketIds = tickets
    .filter((ticket) => ticket.deliveryStatus === 'issued' && ticket.open !== null)
    .map((ticket) => ticket.ticketId);
  const stillPreparing = deliveryStatus === 'pending' || deliveryStatus === 'partial' || tickets.some((ticket) => ticket.deliveryStatus === 'pending');

  return (
    <PurchaseLayout
      {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})}
      className={className}
    >
      <section className="tp-purchase-success" role={isConfirmed ? 'status' : 'alert'}>
        <h3>{isConfirmed
          ? english ? 'Payment confirmed' : 'Оплата подтверждена'
          : english ? 'Payment is not confirmed' : 'Оплата не подтверждена'}</h3>
        <p>{isConfirmed
          ? english ? 'The server confirmed your order.' : 'Сервер подтвердил заказ.'
          : english ? 'Return to payment and refresh its status.' : 'Вернитесь к оплате и обновите статус.'}</p>
        {isConfirmed && loading ? (
          <p role="status">{english ? 'Loading your tickets…' : 'Загружаем билеты…'}</p>
        ) : null}
        {isConfirmed && stillPreparing ? (
          <p role="status">{english ? 'Your tickets are being prepared. This page will update automatically.' : 'Билеты готовятся к выдаче. Страница обновится автоматически.'}</p>
        ) : null}
        {error ? <p className="tp-purchase-success__error" role="alert">{error}</p> : null}
        {actionError ? <p className="tp-purchase-success__error" role="alert">{actionError}</p> : null}
        {tickets.length > 0 ? (
          <ul className="tp-purchase-success__tickets">
            {tickets.map((ticket) => (
              <li key={ticket.ticketId}>
                <span>
                  {[ticket.displayLabels.eventTitle, ticket.displayLabels.occurrenceTitle, ticket.displayLabels.zone, ticket.displayLabels.seat]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <strong>
                  {ticket.deliveryStatus === 'issued'
                    ? english ? 'Ready' : 'Готов'
                    : ticket.deliveryStatus === 'failed'
                      ? english ? 'Could not issue' : 'Не удалось выпустить'
                      : english ? 'Preparing' : 'Готовится'}
                </strong>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <Button tone="secondary" disabled={loading} onClick={() => setRefreshAttempt((attempt) => attempt + 1)}>
            {english ? 'Retry loading tickets' : 'Повторить загрузку билетов'}
          </Button>
        ) : null}
        {issuedTicketIds.length > 0 && purchase.hostActions.onTickets ? (
          <Button tone="primary" onClick={() => void openTickets()}>
            {english ? 'Open tickets' : 'Открыть билеты'}
          </Button>
        ) : null}
        {purchase.hostActions.onHistory ? (
          <Button tone="secondary" onClick={() => purchase.hostActions.onHistory?.()}>
            {english ? 'Order history' : 'История заказов'}
          </Button>
        ) : null}
      </section>
    </PurchaseLayout>
  );
}

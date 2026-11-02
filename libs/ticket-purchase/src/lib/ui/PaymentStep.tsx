import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuyerOrder, BuyerPaymentAttempt, BuyerQuote, BuyerSessionResume } from '@hall-platform/api-contracts';
import { BuyerApiError } from '@hall-platform/api-axios';
import { Button } from '@hall-platform/ui';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';
import { useTicketPurchaseController } from '../model/useTicketPurchase.js';
import type { PromoStatus } from './PromoCodeField.js';
import { PromoCodeField } from './PromoCodeField.js';
import { OrderSummary } from './OrderSummary.js';
import { PurchaseLayout } from './PurchaseLayout.js';
import { PurchaseSuccess } from './PurchaseSuccess.js';

type PaymentBusy = 'order' | 'quote' | 'checkout' | 'refresh' | null;

function newIdempotencyKey(operation: string): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${operation}-${random}`;
}

function errorMessage(error: unknown, locale: string): string {
  if (error instanceof BuyerApiError) {
    if (error.code === 'verification_required') return locale.toLowerCase().startsWith('en')
      ? 'Verify your email before starting payment.'
      : 'Подтвердите почту перед оплатой.';
    if (error.code === 'hold_expired') return locale.toLowerCase().startsWith('en')
      ? 'The reservation expired. Select tickets and reserve again.'
      : 'Время резерва истекло. Выберите билеты и создайте резерв ещё раз.';
    if (error.code === 'invalid_promo') return locale.toLowerCase().startsWith('en')
      ? 'This promotion code is not valid.'
      : 'Этот промокод недействителен.';
  }
  return error instanceof Error
    ? error.message
    : locale.toLowerCase().startsWith('en') ? 'Something went wrong. Try again.' : 'Что-то пошло не так. Попробуйте ещё раз.';
}

function orderSubtotal(order: BuyerOrder): number {
  return order.lines.reduce((total, line) => total + line.totalMinor, 0);
}

function pendingPayment(attempt: BuyerPaymentAttempt | null): boolean {
  return Boolean(attempt && ['created', 'action_required', 'processing'].includes(attempt.status));
}

function quoteMatchesOrder(quote: BuyerQuote, order: BuyerOrder): boolean {
  const lineKey = (line: BuyerOrder['lines'][number]) =>
    JSON.stringify([line.label, line.quantity, line.unitPriceMinor, line.totalMinor]);
  const orderLines = order.lines.map(lineKey).sort();
  const quoteLines = quote.lines.map(lineKey).sort();
  return quote.orderId === order.id && quote.currency === order.currency &&
    quote.ticketsSubtotalMinor === orderSubtotal(order) && order.quoteId === quote.quoteId &&
    orderLines.length === quoteLines.length && orderLines.every((line, index) => line === quoteLines[index]);
}

function verificationIsCurrent(session: BuyerSessionResume): boolean {
  return Boolean(session.contact && session.emailVerification?.status === 'verified' &&
    session.emailVerification.verifiedEmail === session.contact.email);
}

function formatDateTime(locale: string, value: string): string {
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }
}

export type PaymentStepProps = Readonly<{
  className?: string;
  onOrderConfirmed?: (order: BuyerOrder) => void;
}>;

/** Server quote, promo, order and payment handoff step. */
export function PaymentStep({ className = '', onOrderConfirmed }: PaymentStepProps) {
  const purchase = useTicketPurchase();
  const { dataSource, locale, setStep } = purchase;
  const { controller, snapshot } = useTicketPurchaseController();
  const sessionId = snapshot.purchaseSessionId;
  const occurrenceId = snapshot.occurrence?.occurrenceId;
  const contextKey = sessionId && occurrenceId ? `${sessionId}:${occurrenceId}` : null;
  const requiresEmailVerification = snapshot.context?.capabilities.emailVerification === true;
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [resume, setResume] = useState<BuyerSessionResume | null>(null);
  const [paymentAttempt, setPaymentAttempt] = useState<BuyerPaymentAttempt | null>(null);
  const [quote, setQuote] = useState<BuyerQuote | null>(null);
  const quoteRef = useRef<BuyerQuote | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoStatus, setPromoStatus] = useState<PromoStatus>('idle');
  const [promoError, setPromoError] = useState<string | null>(null);
  const [quoteRequiresConfirmation, setQuoteRequiresConfirmation] = useState(false);
  const [quoteConfirmed, setQuoteConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<PaymentBusy>(null);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const orderKey = useRef<{ payload: string; key: string } | null>(null);
  const quoteKey = useRef<{ payload: string; key: string } | null>(null);
  const checkoutKey = useRef<{ payload: string; key: string } | null>(null);
  const quoteSequence = useRef(0);
  const checkoutInFlight = useRef<Promise<void> | null>(null);
  const activeContextKey = useRef<string | null>(null);
  const activeDataSource = useRef(dataSource);
  const onOrderConfirmedRef = useRef(onOrderConfirmed);
  const refreshPaymentStatusRef = useRef<(orderId?: string) => void>(() => undefined);
  const pendingPaymentReturnOrderId = useRef<string | null>(null);
  const english = purchase.locale.toLowerCase().startsWith('en');

  useEffect(() => {
    onOrderConfirmedRef.current = onOrderConfirmed;
  }, [onOrderConfirmed]);

  const setCurrentQuote = useCallback((next: BuyerQuote | null) => {
    quoteRef.current = next;
    setQuote(next);
  }, []);

  const requestQuote = useCallback(async (orderToQuote: BuyerOrder, promo: string | null, signal?: AbortSignal): Promise<void> => {
    if (!sessionId) return;
    const requestSequence = ++quoteSequence.current;
    const code = promo?.trim() || null;
    const payload = JSON.stringify({ orderId: orderToQuote.id, revision: orderToQuote.revision, promoCode: code });
    const key = quoteKey.current?.payload === payload ? quoteKey.current.key : newIdempotencyKey('buyer-quote');
    quoteKey.current = { payload, key };
    const previousTotal = quoteRef.current?.totalMinor ?? orderSubtotal(orderToQuote);
    setBusy('quote');
    setPromoStatus('applying');
    setPromoError(null);
    setMessage(null);
    try {
      let freshOrder = orderToQuote;
      let nextQuote: BuyerQuote;
      try {
        nextQuote = await dataSource.createQuote(sessionId, orderToQuote.id, orderToQuote.revision, code, key, signal);
      } catch (cause) {
        if (!(cause instanceof BuyerApiError) || !['revision_conflict', 'quote_expired'].includes(cause.code)) throw cause;
        freshOrder = await dataSource.getOrder(sessionId, orderToQuote.id, signal);
        const retryPayload = JSON.stringify({ orderId: freshOrder.id, revision: freshOrder.revision, promoCode: code });
        const retryKey = newIdempotencyKey('buyer-quote');
        quoteKey.current = { payload: retryPayload, key: retryKey };
        nextQuote = await dataSource.createQuote(sessionId, freshOrder.id, freshOrder.revision, code, retryKey, signal);
      }
      const updatedOrder = await dataSource.getOrder(sessionId, freshOrder.id, signal);
      if (requestSequence !== quoteSequence.current || signal?.aborted) return;
      if (updatedOrder.id !== freshOrder.id || updatedOrder.occurrenceId !== occurrenceId) {
        throw new BuyerApiError('invalid_response', 'The refreshed order does not match this event time');
      }
      setOrder((current) => !current || updatedOrder.revision >= current.revision ? updatedOrder : current);
      if (!quoteMatchesOrder(nextQuote, updatedOrder)) {
        throw new BuyerApiError('invalid_response', 'The quote does not match the current order or currency');
      }
      try {
        new Intl.NumberFormat('en-US', { style: 'currency', currency: nextQuote.currency });
      } catch {
        throw new BuyerApiError('invalid_response', 'The quote uses an unsupported currency');
      }
      if (nextQuote.promo.status === 'applied' && !nextQuote.promo.code) {
        throw new BuyerApiError('invalid_response', 'An applied promotion must include its code');
      }
      quoteKey.current = null;
      setCurrentQuote(nextQuote);
      const changed = nextQuote.totalMinor !== previousTotal;
      setQuoteRequiresConfirmation(changed);
      setQuoteConfirmed(false);
      if (nextQuote.promo.status === 'invalid' || nextQuote.promo.status === 'expired') {
        setPromoStatus('invalid');
        setPromoError(english ? 'The promotion code could not be applied.' : 'Не удалось применить промокод.');
      } else if (nextQuote.promo.status === 'applied') {
        setPromoStatus('applied');
        setPromoError(null);
      } else {
        setPromoStatus(code ? 'invalid' : 'idle');
        setPromoError(code ? english ? 'The promotion code was not applied.' : 'Промокод не применён.' : null);
      }
      if (changed) setMessage(english
        ? 'The server total changed. Review and confirm the new amount before paying.'
        : 'Итоговая сумма изменилась. Проверьте и подтвердите её перед оплатой.');
    } catch (cause) {
      if (requestSequence !== quoteSequence.current || signal?.aborted) return;
      setPromoError(errorMessage(cause, locale));
      setPromoStatus(code ? 'invalid' : 'idle');
      setMessage(null);
      if (cause instanceof BuyerApiError && cause.code === 'hold_expired') {
        setStep('selection');
        void controller.retry();
      }
    } finally {
      if (requestSequence === quoteSequence.current) setBusy(null);
    }
  }, [controller, dataSource, english, locale, occurrenceId, sessionId, setCurrentQuote, setStep]);

  const restorePaymentState = useCallback(async (signal?: AbortSignal): Promise<{ resume: BuyerSessionResume; order: BuyerOrder | null }> => {
    if (!sessionId) throw new BuyerApiError('not_found', 'Purchase session is unavailable');
    const session = await dataSource.resumeSession(sessionId, signal);
    if (session.purchaseSessionId !== sessionId || session.occurrenceId !== occurrenceId) {
      throw new BuyerApiError('invalid_response', 'The resumed purchase session does not match this event time');
    }
    const currentOrder = session.activeOrder
      ? await dataSource.getOrder(sessionId, session.activeOrder.id, signal)
      : null;
    if (currentOrder && (currentOrder.id !== session.activeOrder?.id || currentOrder.occurrenceId !== occurrenceId)) {
      throw new BuyerApiError('invalid_response', 'The restored order belongs to another event time');
    }
    return { resume: session, order: currentOrder };
  }, [dataSource, occurrenceId, sessionId]);

  useEffect(() => {
    if (!sessionId || !occurrenceId) return;
    if (activeContextKey.current !== contextKey || activeDataSource.current !== dataSource) {
      activeContextKey.current = contextKey;
      activeDataSource.current = dataSource;
      quoteSequence.current += 1;
      setLoadError(null);
      setOrder(null);
      setResume(null);
      setPaymentAttempt(null);
      setCurrentQuote(null);
      setPromoCode('');
      setPromoStatus('idle');
      setPromoError(null);
      setQuoteRequiresConfirmation(false);
      setQuoteConfirmed(false);
      setMessage(null);
      orderKey.current = null;
      quoteKey.current = null;
      checkoutKey.current = null;
      checkoutInFlight.current = null;
    }
    const request = new AbortController();
    let active = true;
    void (async () => {
      try {
        const session = await dataSource.resumeSession(sessionId, request.signal);
        if (session.purchaseSessionId !== sessionId || session.occurrenceId !== occurrenceId) {
          throw new BuyerApiError('invalid_response', 'The resumed purchase session does not match this event time');
        }
        let currentOrder = session.activeOrder
          ? await dataSource.getOrder(sessionId, session.activeOrder.id, request.signal)
          : null;
        if (!active || request.signal.aborted) return;
        if (currentOrder && (currentOrder.id !== session.activeOrder?.id || currentOrder.occurrenceId !== occurrenceId)) {
          throw new BuyerApiError('invalid_response', 'The restored order belongs to another event time');
        }
        if (currentOrder?.status === 'confirmed' && currentOrder.paymentStatus === 'paid') {
          setResume(session);
          setOrder(currentOrder);
          setPaymentAttempt(session.activePaymentAttempt);
          setLoadedContextKey(contextKey);
          setStep('success');
          onOrderConfirmedRef.current?.(currentOrder);
          return;
        }
        if (currentOrder?.status === 'expired') {
          setResume(session);
          setOrder(currentOrder);
          setLoadedContextKey(contextKey);
          setLoadError(english
            ? 'The order expired before payment. Refresh ticket availability to start again.'
            : 'Срок заказа истёк до оплаты. Обновите наличие билетов, чтобы начать заново.');
          setStep('selection');
          void controller.retry();
          return;
        }
        if (!session.contact || (requiresEmailVerification && !verificationIsCurrent(session))) {
          setResume(session);
          setLoadedContextKey(contextKey);
          setLoadError(english
            ? 'Complete and verify your contact details before continuing to payment.'
            : 'Заполните и подтвердите контактные данные, прежде чем переходить к оплате.');
          setStep('contacts');
          return;
        }
        if (currentOrder && currentOrder.contactRevision !== session.contactRevision) {
          setResume(session);
          setOrder(currentOrder);
          setLoadedContextKey(contextKey);
          setLoadError(english
            ? 'Contact details changed after this order was created. Return to contacts to review them.'
            : 'Контактные данные изменились после создания заказа. Вернитесь к контактам и проверьте их.');
          setStep('contacts');
          return;
        }
        if (!currentOrder) {
          const hold = session.ownHold;
          if (!hold || hold.status !== 'active' || hold.ownerSessionId !== sessionId || hold.occurrenceId !== occurrenceId) {
            setResume(session);
            setLoadedContextKey(contextKey);
            setLoadError(english ? 'The ticket reservation is no longer active.' : 'Резерв билетов больше не активен.');
            setStep('selection');
            void controller.retry();
            return;
          }
          const payload = JSON.stringify({ holdId: hold.id, contactRevision: session.contactRevision });
          const key = orderKey.current?.payload === payload ? orderKey.current.key : newIdempotencyKey('buyer-order');
          orderKey.current = { payload, key };
          setBusy('order');
          currentOrder = await dataSource.createOrder(sessionId, hold.id, session.contactRevision, key, request.signal);
          if (!active || request.signal.aborted) return;
          if (currentOrder.occurrenceId !== occurrenceId || currentOrder.holdId !== hold.id) {
            throw new BuyerApiError('invalid_response', 'The created order does not match this reservation');
          }
          orderKey.current = null;
          const refreshedSession = await dataSource.resumeSession(sessionId, request.signal).catch(() => session);
          if (refreshedSession.purchaseSessionId !== sessionId || refreshedSession.occurrenceId !== occurrenceId) {
            throw new BuyerApiError('invalid_response', 'The refreshed session does not match this event time');
          }
          setResume(refreshedSession);
          setPaymentAttempt(refreshedSession.activePaymentAttempt);
        } else {
          setResume(session);
          setPaymentAttempt(session.activePaymentAttempt);
        }
        if (!active || request.signal.aborted || !currentOrder) return;
        setOrder(currentOrder);
        setLoadedContextKey(contextKey);
        const hasUnresolvedPayment = currentOrder.paymentStatus === 'pending' || pendingPayment(session.activePaymentAttempt);
        if (hasUnresolvedPayment) return;
        await requestQuote(currentOrder, null, request.signal);
      } catch (cause) {
        if (!active || request.signal.aborted) return;
        if (cause instanceof BuyerApiError && cause.code === 'verification_required') {
          setLoadError(errorMessage(cause, locale));
          setStep('contacts');
        } else if (cause instanceof BuyerApiError && cause.code === 'hold_expired') {
          setLoadError(errorMessage(cause, locale));
          setStep('selection');
          void controller.retry();
        } else {
          setLoadError(errorMessage(cause, locale));
        }
        setLoadedContextKey(contextKey);
      }
    })();
    return () => {
      active = false;
      request.abort();
    };
  }, [contextKey, controller, dataSource, english, locale, occurrenceId, requestQuote, setCurrentQuote, setStep, requiresEmailVerification, resumeAttempt, sessionId]);

  const refreshPaymentStatus = useCallback(async (expectedOrderId?: string) => {
    if (!sessionId) {
      if (expectedOrderId) pendingPaymentReturnOrderId.current = expectedOrderId;
      return;
    }
    if (busy) {
      if (expectedOrderId) pendingPaymentReturnOrderId.current = expectedOrderId;
      return;
    }
    const operationContextKey = contextKey;
    setBusy('refresh');
    setMessage(null);
    try {
      const restored = await restorePaymentState();
      if (activeContextKey.current !== operationContextKey) return;
      if (expectedOrderId && restored.order?.id !== expectedOrderId) {
        setMessage(english
          ? 'The returned payment does not match the current server order.'
          : 'Возврат из оплаты не соответствует текущему заказу на сервере.');
        return;
      }
      setResume(restored.resume);
      setOrder(restored.order);
      setPaymentAttempt(restored.resume.activePaymentAttempt);
      setLoadError(null);
      if (restored.order?.status === 'confirmed' && restored.order.paymentStatus === 'paid') {
        setStep('success');
        onOrderConfirmedRef.current?.(restored.order);
        return;
      }
      const hasPendingPayment = restored.order?.paymentStatus === 'pending' || pendingPayment(restored.resume.activePaymentAttempt);
      if (!restored.order) {
        setCurrentQuote(null);
        setQuoteRequiresConfirmation(false);
        setQuoteConfirmed(false);
      } else if (!hasPendingPayment && (
        !quoteRef.current || !quoteMatchesOrder(quoteRef.current, restored.order) ||
        restored.order.paymentStatus === 'failed' || restored.order.paymentStatus === 'cancelled'
      )) {
        await requestQuote(restored.order, promoCode.trim() || null);
        return;
      }
      setMessage(english ? 'Payment status refreshed from the server.' : 'Статус оплаты обновлён с сервера.');
    } catch (cause) {
      if (activeContextKey.current !== operationContextKey) return;
      setMessage(errorMessage(cause, locale));
    } finally {
      if (activeContextKey.current === operationContextKey) setBusy(null);
    }
  }, [busy, contextKey, english, locale, promoCode, requestQuote, restorePaymentState, sessionId, setCurrentQuote, setStep]);

  useEffect(() => {
    refreshPaymentStatusRef.current = (expectedOrderId) => {
      if (expectedOrderId) pendingPaymentReturnOrderId.current = expectedOrderId;
      if (!sessionId || busy) return;
      const pendingOrderId = pendingPaymentReturnOrderId.current;
      if (pendingOrderId) pendingPaymentReturnOrderId.current = null;
      if (!pendingOrderId && !(order?.paymentStatus === 'pending' || pendingPayment(paymentAttempt))) return;
      void refreshPaymentStatus(pendingOrderId ?? undefined);
    };
  }, [busy, order?.paymentStatus, paymentAttempt, refreshPaymentStatus, sessionId]);

  useEffect(() => {
    if (!busy && sessionId && pendingPaymentReturnOrderId.current) {
      refreshPaymentStatusRef.current(pendingPaymentReturnOrderId.current);
    }
  }, [busy, sessionId]);

  useEffect(() => {
    const refreshAfterResume = () => {
      if (document.visibilityState !== 'hidden') refreshPaymentStatusRef.current();
    };
    const refreshAfterHostReturn = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string; orderId?: string }>).detail;
      if (detail?.instanceId !== purchase.instanceId || !detail.orderId) return;
      refreshPaymentStatusRef.current(detail.orderId);
    };
    window.addEventListener('focus', refreshAfterResume);
    window.addEventListener('pageshow', refreshAfterResume);
    window.addEventListener('online', refreshAfterResume);
    document.addEventListener('visibilitychange', refreshAfterResume);
    window.addEventListener('ticket-purchase:payment-returned', refreshAfterHostReturn);
    window.addEventListener('ticket-purchase:resume', refreshAfterResume);
    return () => {
      window.removeEventListener('focus', refreshAfterResume);
      window.removeEventListener('pageshow', refreshAfterResume);
      window.removeEventListener('online', refreshAfterResume);
      document.removeEventListener('visibilitychange', refreshAfterResume);
      window.removeEventListener('ticket-purchase:payment-returned', refreshAfterHostReturn);
      window.removeEventListener('ticket-purchase:resume', refreshAfterResume);
    };
  }, [purchase.instanceId]);

  async function handoffToHost(attempt: BuyerPaymentAttempt) {
    if (attempt.action.kind === 'none') {
      setMessage(english
        ? 'The server is processing the payment. Check its status before continuing.'
        : 'Сервер обрабатывает оплату. Проверьте её статус перед продолжением.');
      return;
    }
    if (!purchase.hostActions.onPaymentRequested) {
      setMessage(english
        ? 'Payment is ready, but this host has no payment handler configured.'
        : 'Оплата подготовлена, но на сайте не настроен обработчик платежа.');
      return;
    }
    try {
      await purchase.hostActions.onPaymentRequested(attempt);
      setMessage(english
        ? 'Payment was handed to the host. The order is not confirmed until the server reports success.'
        : 'Оплата передана сайту. Заказ будет подтверждён, когда сервер сообщит об успехе.');
      window.setTimeout(() => refreshPaymentStatusRef.current(), 0);
    } catch (cause) {
      setMessage(errorMessage(cause, purchase.locale));
    }
  }

  async function checkout() {
    if (!sessionId || !order || !quote || busy || checkoutInFlight.current) return;
    if (order.paymentStatus === 'pending' || pendingPayment(paymentAttempt)) {
      if (paymentAttempt && pendingPayment(paymentAttempt)) await handoffToHost(paymentAttempt);
      else setMessage(english
        ? 'A payment is already pending. Refresh its status before trying again.'
        : 'Платёж уже ожидает подтверждения. Обновите его статус перед повторной попыткой.');
      return;
    }
    if (order.quoteId !== quote.quoteId || !quoteMatchesOrder(quote, order)) {
      setMessage(english ? 'The quote changed. Refresh it before paying.' : 'Расчёт изменился. Обновите его перед оплатой.');
      return;
    }
    if (quote.promo.status === 'invalid' || quote.promo.status === 'expired') {
      setMessage(english ? 'Remove or change the invalid promotion code before paying.' : 'Удалите или измените недействительный промокод перед оплатой.');
      return;
    }
    if (quoteRequiresConfirmation && !quoteConfirmed) {
      setQuoteConfirmed(true);
      setMessage(english ? 'New total confirmed. Review it once more and press Pay.' : 'Новая сумма подтверждена. Проверьте её и нажмите «Оплатить».');
      return;
    }
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      setMessage(english ? 'The quote expired. A fresh total is being requested.' : 'Срок расчёта истёк. Запрашиваем новую сумму.');
      await requestQuote(order, promoCode.trim() || null);
      return;
    }
    const quoteInputMatches = !promoCode.trim()
      ? quote.promo.status === 'none'
      : quote.promo.status === 'applied' && quote.promo.code?.toUpperCase() === promoCode.trim().toUpperCase();
    if (!quoteInputMatches) {
      setMessage(english ? 'Apply the current promotion code before paying.' : 'Примените текущий промокод перед оплатой.');
      return;
    }
    const payload = JSON.stringify({ orderId: order.id, quoteId: quote.quoteId, quoteRevision: quote.revision, orderRevision: order.revision });
    const key = checkoutKey.current?.payload === payload ? checkoutKey.current.key : newIdempotencyKey('buyer-checkout');
    const operationContextKey = contextKey;
    checkoutKey.current = { payload, key };
    setBusy('checkout');
    setMessage(null);
    const operation = (async () => {
      try {
        const result = await purchase.dataSource.checkout(sessionId, order.id, {
          quoteId: quote.quoteId,
          quoteRevision: quote.revision,
          orderRevision: order.revision,
        }, key);
        if (activeContextKey.current !== operationContextKey) return;
        if (result.order.id !== order.id || result.paymentAttempt.orderId !== order.id) {
          throw new BuyerApiError('invalid_response', 'The payment attempt does not match this order');
        }
        checkoutKey.current = null;
        setOrder(result.order);
        setPaymentAttempt(result.paymentAttempt);
        if (result.order.status === 'confirmed' && result.order.paymentStatus === 'paid') {
          purchase.setStep('success');
          onOrderConfirmedRef.current?.(result.order);
          return;
        }
        await handoffToHost(result.paymentAttempt);
      } catch (cause) {
        if (activeContextKey.current !== operationContextKey) return;
        if (cause instanceof BuyerApiError && cause.code === 'verification_required') {
          checkoutKey.current = null;
          purchase.setStep('contacts');
          setMessage(errorMessage(cause, purchase.locale));
          return;
        }
        if (cause instanceof BuyerApiError && cause.code === 'hold_expired') {
          checkoutKey.current = null;
          setMessage(errorMessage(cause, purchase.locale));
          purchase.setStep('selection');
          void controller.retry();
          return;
        }
        if (cause instanceof BuyerApiError && cause.code === 'quote_expired') {
          setMessage(english ? 'The quote expired. Review the updated amount.' : 'Срок расчёта истёк. Проверьте новую сумму.');
          await requestQuote(order, promoCode.trim() || null);
          return;
        }
        try {
          const restored = await restorePaymentState();
          if (activeContextKey.current !== operationContextKey) return;
          setResume(restored.resume);
          setOrder(restored.order);
          setPaymentAttempt(restored.resume.activePaymentAttempt);
          if (restored.order?.status === 'confirmed' && restored.order.paymentStatus === 'paid') {
            checkoutKey.current = null;
            purchase.setStep('success');
            onOrderConfirmedRef.current?.(restored.order);
            return;
          }
          if (!restored.resume.contact || (requiresEmailVerification && !verificationIsCurrent(restored.resume)) ||
              (restored.order && restored.order.contactRevision !== restored.resume.contactRevision)) {
            setMessage(english
              ? 'Contact details need to be reviewed before payment can continue.'
              : 'Перед продолжением оплаты нужно проверить контактные данные.');
            purchase.setStep('contacts');
            return;
          }
          if (restored.order?.paymentStatus === 'pending' || pendingPayment(restored.resume.activePaymentAttempt)) {
            checkoutKey.current = null;
            setMessage(english
              ? 'The payment request was accepted. Check its status or reopen it through the host.'
              : 'Запрос оплаты принят. Проверьте статус или повторно откройте оплату через сайт.');
            return;
          }
          if (restored.order && quoteRef.current && !quoteMatchesOrder(quoteRef.current, restored.order)) {
            await requestQuote(restored.order, promoCode.trim() || null);
            return;
          }
          const finalPaymentState = restored.resume.activePaymentAttempt?.status;
          if (restored.order?.paymentStatus === 'failed' || restored.order?.paymentStatus === 'cancelled' ||
              finalPaymentState === 'failed' || finalPaymentState === 'cancelled' || finalPaymentState === 'expired') {
            checkoutKey.current = null;
          }
        } catch {
          // The saved idempotency key is retained so the same checkout can be retried safely.
        }
        setMessage(errorMessage(cause, purchase.locale));
      } finally {
        if (activeContextKey.current === operationContextKey) setBusy(null);
      }
    })();
    checkoutInFlight.current = operation;
    await operation.finally(() => {
      if (checkoutInFlight.current === operation) checkoutInFlight.current = null;
    });
  }

  function handlePromoChange(value: string) {
    setPromoCode(value);
    quoteSequence.current += 1;
    setBusy((current) => current === 'quote' ? null : current);
    setPromoStatus(value.trim() ? 'editing' : quote?.promo.status === 'applied' ? 'editing' : 'idle');
    setPromoError(null);
    setQuoteConfirmed(false);
    setMessage(null);
  }

  function clearPromo() {
    setPromoCode('');
    setQuoteRequiresConfirmation(false);
    setQuoteConfirmed(false);
    if (order) void requestQuote(order, null);
  }

  function retryRestore() {
    setLoadError(null);
    setLoadedContextKey(null);
    setResumeAttempt((attempt) => attempt + 1);
  }

  const isLoading = Boolean(contextKey && loadedContextKey !== contextKey);
  const currentQuoteIsUsable = Boolean(order && quote && quoteMatchesOrder(quote, order));
  const selectedCount = order?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0;
  const pending = order?.paymentStatus === 'pending' || pendingPayment(paymentAttempt);

  if (!sessionId || !occurrenceId) {
    return (
      <PurchaseLayout {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})} className={className}>
        <section className="tp-payment-state" role="alert">
          <h3>{english ? 'Purchase session is unavailable' : 'Сессия покупки недоступна'}</h3>
          <p>{english ? 'Return to ticket selection to restore your purchase session.' : 'Вернитесь к выбору билетов, чтобы восстановить сессию покупки.'}</p>
          <Button tone="secondary" onClick={() => { purchase.setStep('selection'); void controller.retry(); }}>
            {english ? 'Return to tickets' : 'К билетам'}
          </Button>
        </section>
      </PurchaseLayout>
    );
  }

  if (isLoading) {
    return <PurchaseLayout occurrence={snapshot.occurrence ?? undefined} loading className={className} />;
  }

  if (loadError) {
    return (
      <PurchaseLayout
        {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})}
        className={className}
        backAction={{ label: english ? 'Back to contacts' : 'Назад к контактным данным', onClick: () => purchase.setStep('contacts') }}
      >
        <section className="tp-payment-state" role="alert">
          <h3>{english ? 'Payment cannot continue' : 'Нельзя продолжить оплату'}</h3>
          <p>{loadError}</p>
          <Button tone="secondary" onClick={retryRestore}>{english ? 'Try again' : 'Попробовать снова'}</Button>
        </section>
      </PurchaseLayout>
    );
  }

  if (order?.status === 'confirmed' && order.paymentStatus === 'paid') {
    return <PurchaseSuccess order={order} className={className} />;
  }

  return (
    <PurchaseLayout
      {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})}
      className={className}
      backAction={{ label: english ? 'Back to contact details' : 'Назад к контактным данным', onClick: () => purchase.setStep('contacts') }}
    >
      <section className="tp-payment-step">
        <div className="tp-payment-step__heading">
          <h3>{english ? 'Payment' : 'Оплата'}</h3>
          <p>{english ? 'Review the server total and select how to continue.' : 'Проверьте итоговую сумму и перейдите к оплате.'}</p>
        </div>
        {message ? <p className="tp-payment-step__message" role="status">{message}</p> : null}
        {pending ? (
          <section className="tp-payment-pending" aria-live="polite">
            <h4>{english ? 'Payment is pending' : 'Ожидаем подтверждение оплаты'}</h4>
            <p>{english
              ? 'Closing a payment window does not mean that the payment failed. Check the order status with the server.'
              : 'Закрытие окна оплаты не означает, что платёж отклонён. Проверьте статус заказа на сервере.'}</p>
            <div className="tp-payment-pending__actions">
              <Button tone="secondary" disabled={busy !== null} onClick={() => void refreshPaymentStatus()}>
                {busy === 'refresh' ? english ? 'Checking…' : 'Проверяем…' : english ? 'Check payment status' : 'Проверить статус оплаты'}
              </Button>
              {paymentAttempt && pendingPayment(paymentAttempt) ? (
                <Button tone="primary" disabled={busy !== null} onClick={() => void handoffToHost(paymentAttempt)}>
                  {english ? 'Open payment' : 'Открыть оплату'}
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <>
            {order ? (
              <PromoCodeField
                value={promoCode}
                {...(quote?.promo.code ? { appliedCode: quote.promo.code } : {})}
                status={promoStatus}
                locale={purchase.locale}
                error={promoError}
                applying={busy === 'quote'}
                disabled={busy === 'checkout' || busy === 'order' || busy === 'refresh'}
                onChange={handlePromoChange}
                onApply={() => { if (order) void requestQuote(order, promoCode.trim() || null); }}
                onClear={clearPromo}
              />
            ) : null}
            {order && quote ? (
              <OrderSummary
                quote={quote}
                totalMinor={quote.totalMinor}
                currency={quote.currency}
                locale={purchase.locale}
                selectedCount={selectedCount}
                disabled={busy !== null || !currentQuoteIsUsable || promoStatus === 'editing' || promoStatus === 'invalid' || promoError !== null || quote.promo.status === 'invalid' || quote.promo.status === 'expired'}
                loading={busy === 'checkout'}
                loadingLabel={english ? 'Starting payment…' : 'Создаём оплату…'}
                continueLabel={quoteRequiresConfirmation && !quoteConfirmed
                  ? english ? 'Confirm updated total' : 'Подтвердить новую сумму'
                  : english ? 'Pay' : 'Оплатить'}
                error={message}
                onContinue={() => void checkout()}
              />
            ) : (
              <p className="tp-payment-step__loading" role="status">
                {english ? 'Loading the server total…' : 'Загружаем итоговую сумму…'}
              </p>
            )}
            {quote ? (
              <p className="tp-quote-expiry">
                {english ? 'Quote expires' : 'Расчёт действует до'}: {formatDateTime(purchase.locale, quote.expiresAt)}
              </p>
            ) : null}
          </>
        )}
        {order?.status === 'failed' || order?.status === 'cancelled' ? (
          <p className="tp-payment-step__error" role="alert">
            {english ? 'The previous payment did not complete. Review the current total and try again.' : 'Предыдущая оплата не завершилась. Проверьте текущую сумму и попробуйте снова.'}
          </p>
        ) : null}
        {resume && !resume.contact ? (
          <p className="tp-payment-step__error" role="alert">{english ? 'Contact details are required.' : 'Необходимо заполнить контактные данные.'}</p>
        ) : null}
      </section>
    </PurchaseLayout>
  );
}

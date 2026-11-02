import { useCallback, useEffect, useRef, useState } from 'react';
import { BuyerApiError } from '@hall-platform/api-axios';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';
import { useTicketPurchaseController } from './useTicketPurchase.js';

export type PurchaseSessionResumeState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  retry: () => void;
}>;

/** Restores the current order before a buyer starts another checkout after reload. */
export function usePurchaseSessionResume(eventId: string, occurrenceId: string): PurchaseSessionResumeState {
  const purchase = useTicketPurchase();
  const { snapshot } = useTicketPurchaseController();
  const { dataSource, instanceId, setStep } = purchase;
  const sessionId = snapshot.purchaseSessionId;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ sessionId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null }>({
    sessionId: null,
    status: 'idle',
    error: null,
  });
  const requested = useRef<{ sessionId: string; attempt: number } | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    if (snapshot.status === 'idle' || snapshot.status === 'loading') return;
    if (requested.current?.sessionId === sessionId && requested.current.attempt === attempt) return;

    const request = new AbortController();
    requested.current = { sessionId, attempt };
    let settled = false;
    const loadingTimer = window.setTimeout(() => {
      if (!settled && !request.signal.aborted) setState({ sessionId, status: 'loading', error: null });
    }, 0);
    void dataSource.resumeSession(sessionId, request.signal).then((resume) => {
      if (request.signal.aborted) return;
      if (resume.purchaseSessionId !== sessionId || resume.occurrenceId !== occurrenceId ||
          snapshot.eventId !== eventId || snapshot.occurrence?.occurrenceId !== occurrenceId) {
        throw new BuyerApiError('invalid_response', 'The resumed purchase session does not match this event time');
      }
      settled = true;
      window.clearTimeout(loadingTimer);
      setState({ sessionId, status: 'ready', error: null });
      if (resume.activeOrder) setStep('payment');
    }).catch((cause: unknown) => {
      if (request.signal.aborted) return;
      settled = true;
      window.clearTimeout(loadingTimer);
      setState({
        sessionId,
        status: 'error',
        error: cause instanceof BuyerApiError && cause.code === 'invalid_response'
          ? 'The saved purchase session does not match this event time.'
          : 'Could not restore the saved purchase session. Retry before choosing tickets.',
      });
    });
    return () => {
      window.clearTimeout(loadingTimer);
      request.abort();
    };
  }, [attempt, dataSource, eventId, occurrenceId, sessionId, setStep, snapshot.eventId, snapshot.occurrence?.occurrenceId, snapshot.status]);

  useEffect(() => {
    const resumeFromHost = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
      if (detail?.instanceId === instanceId) retry();
    };
    window.addEventListener('ticket-purchase:resume', resumeFromHost);
    window.addEventListener('ticket-purchase:payment-returned', resumeFromHost);
    return () => {
      window.removeEventListener('ticket-purchase:resume', resumeFromHost);
      window.removeEventListener('ticket-purchase:payment-returned', resumeFromHost);
    };
  }, [instanceId, retry]);

  return state.sessionId === sessionId
    ? { status: state.status, error: state.error, retry }
    : { status: 'idle', error: null, retry };
}

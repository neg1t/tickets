import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuyerOrder, BuyerPaymentAttempt } from '@hall-platform/api-contracts';
import type { TicketPurchaseTheme } from '@hall-platform/ticket-purchase';
import { createHttpPurchaseDataSource } from '@hall-platform/ticket-purchase/http';
import { Button, TicketPurchaseProvider, TicketPurchaseWidget, useTicketPurchase, useTicketPurchaseController } from '@hall-platform/ticket-purchase';
import type { PurchaseDataSource } from '@hall-platform/ticket-purchase';
import { createBridgeRequestId, type HostBridgeMessage, type HostInitMessage } from '../../../shared/bridge/protocol.js';
import { createWebViewBridge, type WebViewBridge } from '../../../shared/bridge/webViewBridge.js';

type Route = Readonly<{ occurrenceId: string | null; error: string | null }>;
type BridgeState = 'waiting' | 'ready' | 'timeout' | 'error';
const runtimeEnv = __TICKET_PURCHASE_EMBED_ENV__;

function configuredOrigins(value: string | undefined): readonly string[] {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    try {
      const url = new URL(entry);
      const localDevelopment = runtimeEnv.dev && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return url.protocol === 'https:' || (localDevelopment && url.protocol === 'http:') ? [url.origin] : [];
    } catch {
      return [];
    }
  });
}

const allowedHostOrigins = configuredOrigins(runtimeEnv.hostOrigins);
const allowedApiOrigins = new Set([window.location.origin, ...configuredOrigins(runtimeEnv.apiOrigins)]);
const allowedPaymentOrigins = new Set(configuredOrigins(runtimeEnv.paymentOrigins));

function resolveApiBaseUrl(candidate: string | undefined): string {
  const value = candidate ?? runtimeEnv.apiBaseUrl ?? window.location.origin;
  const url = new URL(value, window.location.origin);
  const localDevelopment = runtimeEnv.dev && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !allowedApiOrigins.has(url.origin) || (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:'))) {
    throw new Error('The purchase API origin is not allowlisted.');
  }
  return url.toString().replace(/\/$/, '');
}

function getRoute(pathname: string): Route {
  const match = /^\/buy\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return { occurrenceId: null, error: 'Open this widget at /buy/{occurrenceId}.' };
  try {
    const occurrenceId = decodeURIComponent(match[1]);
    return occurrenceId ? { occurrenceId, error: null } : { occurrenceId: null, error: 'An event time is required.' };
  } catch {
    return { occurrenceId: null, error: 'The event time in this link is invalid.' };
  }
}

function safeLocale(value: string | null): string {
  return value && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value) ? value : 'ru-RU';
}

function normalizeTheme(theme: HostInitMessage['payload']['theme']): Partial<TicketPurchaseTheme> | undefined {
  if (!theme) return undefined;
  return {
    ...(theme.accent !== undefined ? { accent: theme.accent } : {}),
    ...(theme.ink !== undefined ? { ink: theme.ink } : {}),
    ...(theme.surface !== undefined ? { surface: theme.surface } : {}),
    ...(theme.muted !== undefined ? { muted: theme.muted } : {}),
    ...(theme.border !== undefined ? { border: theme.border } : {}),
    ...(theme.background !== undefined ? { background: theme.background } : {}),
    ...(theme.fontFamily !== undefined ? { fontFamily: theme.fontFamily } : {}),
    ...(theme.radius !== undefined ? { radius: theme.radius } : {}),
  };
}

function BridgeHostListener({ bridge, message }: { bridge: WebViewBridge; message: HostBridgeMessage | null }) {
  const purchase = useTicketPurchase();
  const { instanceId, requestBack, dataSource } = purchase;
  const handledRequests = useRef(new Set<string>());
  const { snapshot } = useTicketPurchaseController();

  useEffect(() => {
    if (!message || message.instanceId !== bridge.instanceId) return;
    if (message.type !== 'back' && message.type !== 'resume' && message.type !== 'paymentReturned') return;
    if (handledRequests.current.has(message.requestId)) return;
    const current = snapshot;
    const sessionId = current.purchaseSessionId;
    if (message.type !== 'back' && !current.purchaseSessionId) {
      if (current.status === 'idle' || current.status === 'loading') return;
      handledRequests.current.add(message.requestId);
      bridge.send('ack', { requestId: message.requestId, ok: false, error: 'The purchase session is unavailable.' });
      return;
    }
    handledRequests.current.add(message.requestId);
    if (handledRequests.current.size > 1_000) handledRequests.current.delete(handledRequests.current.values().next().value as string);
    void (async () => {
      try {
        if (message.type === 'back') await requestBack();
        else if (message.type === 'resume') {
          if (!sessionId) throw new Error('session_unavailable');
          const resume = await dataSource.resumeSession(sessionId);
          if (resume.purchaseSessionId !== sessionId || resume.occurrenceId !== current.occurrence?.occurrenceId) {
            throw new Error('session_mismatch');
          }
          window.dispatchEvent(new CustomEvent('ticket-purchase:resume', { detail: { instanceId } }));
        } else {
          if (!sessionId) throw new Error('session_unavailable');
          const resume = await dataSource.resumeSession(sessionId);
          if (resume.purchaseSessionId !== sessionId || resume.occurrenceId !== current.occurrence?.occurrenceId ||
              resume.activeOrder?.id !== message.payload.orderId) {
            throw new Error('order_mismatch');
          }
          const order = await dataSource.getOrder(sessionId, message.payload.orderId);
          if (order.id !== message.payload.orderId || order.occurrenceId !== current.occurrence?.occurrenceId) {
            throw new Error('order_mismatch');
          }
          window.dispatchEvent(new CustomEvent('ticket-purchase:payment-returned', {
            detail: { instanceId, orderId: order.id },
          }));
        }
        bridge.send('ack', { requestId: message.requestId, ok: true });
      } catch {
        bridge.send('ack', {
          requestId: message.requestId,
          ok: false,
          error: 'The widget could not confirm the current purchase state.',
        });
      }
    })();
  }, [bridge, dataSource, instanceId, message, requestBack, snapshot, snapshot.status]);

  useEffect(() => {
    bridge.send('stateChanged', { step: purchase.step, canGoBack: purchase.canGoBack });
  }, [bridge, purchase.canGoBack, purchase.step]);

  return null;
}

type SessionCredential = Readonly<{ purchaseSessionId: string; sessionCredential: string }>;

function hostActionsFor(
  bridge: WebViewBridge,
  eventId: string,
  capabilities: readonly string[],
  paymentOrigins: ReadonlySet<string>,
) {
  const supports = (name: string) => capabilities.includes(name);
  return {
    onBack: () => { bridge.send('closeRequested', {}); },
    ...(supports('eventDetails') ? { onDetails: () => { bridge.send('eventDetailsRequested', { eventId }); } } : {}),
    ...(supports('history') ? { onHistory: () => { bridge.send('historyRequested', {}); } } : {}),
    ...(supports('tickets') ? { onTickets: (ticketIds?: readonly string[]) => {
      if (ticketIds && ticketIds.length > 0) bridge.send('ticketsRequested', { ticketIds: [...ticketIds] });
    } } : {}),
    ...(supports('payment') ? { onPaymentRequested: (attempt: BuyerPaymentAttempt) => {
      if (attempt.action.kind === 'redirect') {
        const target = new URL(attempt.action.url);
        if (target.protocol !== 'https:' || !paymentOrigins.has(target.origin)) {
          return Promise.reject(new Error('The payment URL is not allowlisted.'));
        }
      }
      return bridge.request('paymentRequested', { attempt }, 30_000);
    } } : {}),
    onOrderConfirmed: (order: BuyerOrder) => { bridge.send('orderConfirmed', {
      orderId: order.id,
      status: 'confirmed',
      paymentStatus: 'paid',
      ticketDeliveryStatus: order.ticketDeliveryStatus,
    }); },
    onSessionCreated: (session: SessionCredential & { expiresAt: string }) => {
      bridge.send('sessionCreated', {
        purchaseSessionId: session.purchaseSessionId,
        sessionCredential: session.sessionCredential,
        expiresAt: session.expiresAt,
      });
    },
  };
}

function BridgePurchase({
  eventId,
  occurrenceId,
  init,
  bridge,
  message,
  activeSession,
  bootstrapCredential,
}: {
  eventId: string;
  occurrenceId: string;
  init: HostInitMessage['payload'];
  bridge: WebViewBridge;
  message: HostBridgeMessage | null;
  activeSession?: SessionCredential;
  bootstrapCredential?: string;
}) {
  const initialPurchaseSession = useMemo(() => activeSession
    ? { eventId, occurrenceId, purchaseSessionId: activeSession.purchaseSessionId }
    : undefined, [activeSession, eventId, occurrenceId]);
  const dataSource = useMemo(() => createHttpPurchaseDataSource({
    baseURL: resolveApiBaseUrl(init.apiBaseUrl),
    getSessionCredential: (purchaseSessionId) =>
      activeSession?.purchaseSessionId === purchaseSessionId ? activeSession.sessionCredential : undefined,
  }), [activeSession, init.apiBaseUrl]);
  const hostActions = useMemo(
    () => hostActionsFor(bridge, eventId, init.hostCapabilities, allowedPaymentOrigins),
    [bridge, eventId, init.hostCapabilities],
  );
  const theme = normalizeTheme(init.theme);
  const resolvedBootstrapCredential = bootstrapCredential ?? init.hostBootstrapCredential;

  return (
    <TicketPurchaseProvider
      dataSource={dataSource}
      instanceId={bridge.instanceId}
      {...(initialPurchaseSession ? { initialPurchaseSession } : {})}
      {...(resolvedBootstrapCredential ? { hostBootstrapCredential: resolvedBootstrapCredential } : {})}
      locale={init.locale ?? safeLocale(new URLSearchParams(window.location.search).get('locale'))}
      {...(theme ? { theme } : {})}
      hostActions={hostActions}
    >
      <BridgeHostListener bridge={bridge} message={message} />
      <TicketPurchaseWidget eventId={eventId} occurrenceId={occurrenceId} />
    </TicketPurchaseProvider>
  );
}

function HandshakeState({ state, error, onRetry }: { state: BridgeState; error: string | null; onRetry: () => void }) {
  const english = safeLocale(new URLSearchParams(window.location.search).get('locale')).startsWith('en');
  return (
    <main className="embed-handshake" role={state === 'error' ? 'alert' : 'status'}>
      <h1>{state === 'timeout'
        ? english ? 'Could not connect to the app' : 'Не удалось подключиться к приложению'
        : state === 'error'
          ? english ? 'Could not start ticket purchase' : 'Не удалось открыть покупку билетов'
          : english ? 'Connecting to the app…' : 'Подключаемся к приложению…'}</h1>
      <p>{error ?? (english
        ? 'Waiting for the host app to provide the event and purchase session.'
        : 'Ожидаем от приложения данные события и сессии покупки.')}</p>
      {state === 'timeout' || state === 'error' ? (
        <Button tone="secondary" onClick={onRetry}>{english ? 'Try again' : 'Попробовать снова'}</Button>
      ) : null}
    </main>
  );
}

export function EmbedPage() {
  const route = useMemo(() => getRoute(window.location.pathname), []);
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const demoMode = runtimeEnv.dev && query.get('demo') === '1';
  const [instanceId] = useState(() => `ticket-purchase-${createBridgeRequestId()}`);
  const [bridge, setBridge] = useState<WebViewBridge | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState<HostBridgeMessage | null>(null);
  const [init, setInit] = useState<HostInitMessage['payload'] | null>(null);
  const [resumeSession, setResumeSession] = useState<SessionCredential | undefined>();
  const [bootstrapCredential, setBootstrapCredential] = useState<string | undefined>();
  const [bridgeState, setBridgeState] = useState<BridgeState>('waiting');
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [demoDataSource, setDemoDataSource] = useState<PurchaseDataSource | null>(null);

  useEffect(() => {
    if (!demoMode) return;
    let active = true;
    void import('../../../shared/demo/mockPurchaseDataSource.js').then(({ createMockPurchaseDataSource }) => {
      if (active) setDemoDataSource(createMockPurchaseDataSource());
    }).catch(() => {
      if (!active) return;
      setBridgeError('The development purchase demo could not be loaded.');
      setBridgeState('error');
    });
    return () => { active = false; };
  }, [demoMode]);

  useEffect(() => {
    if (!route.occurrenceId || demoMode) return;
    let connection: WebViewBridge | null = null;
    let sendErrorTimer: number | null = null;
    const timeout = window.setTimeout(() => setBridgeState((state) => state === 'ready' ? state : 'timeout'), 15_000);
    connection = createWebViewBridge({
      instanceId,
      allowedOrigins: allowedHostOrigins,
      onMessage(message) {
        setBridgeMessage(message);
        if (message.type === 'init') {
          if (message.payload.occurrenceId !== route.occurrenceId) {
            connection?.send('ack', { requestId: message.requestId, ok: false, error: 'The event time does not match the widget URL.' });
            connection?.send('error', { code: 'occurrence_mismatch', message: 'The event time does not match the widget URL.' });
            setBridgeState('error');
            setBridgeError('Данные приложения относятся к другому сеансу.');
            return;
          }
          if (connection) setBridge(connection);
          setInit(message.payload);
          setResumeSession(message.payload.session);
          setBootstrapCredential(message.payload.hostBootstrapCredential);
          setBridgeState('ready');
          connection?.send('ack', { requestId: message.requestId, ok: true });
        } else if (message.type === 'authUpdated') {
          if (message.payload.hostBootstrapCredential) setBootstrapCredential(message.payload.hostBootstrapCredential);
          if (message.payload.purchaseSessionId && message.payload.sessionCredential) {
            setResumeSession({
              purchaseSessionId: message.payload.purchaseSessionId,
              sessionCredential: message.payload.sessionCredential,
            });
          }
          connection?.send('ack', { requestId: message.requestId, ok: true });
        }
      },
    });
    try {
      connection.send('ready', { path: window.location.pathname });
    } catch (cause) {
      sendErrorTimer = window.setTimeout(() => {
        setBridgeState('error');
        setBridgeError(cause instanceof Error ? cause.message : 'The trusted host origin is not configured.');
      }, 0);
    }
    return () => {
      window.clearTimeout(timeout);
      if (sendErrorTimer !== null) window.clearTimeout(sendErrorTimer);
      connection?.dispose();
    };
  }, [demoMode, instanceId, retry, route.occurrenceId]);

  if (route.error || !route.occurrenceId) {
    return <HandshakeState state="error" error={route.error} onRetry={() => undefined} />;
  }

  if (demoMode && demoDataSource) {
    return (
      <TicketPurchaseProvider
        dataSource={demoDataSource}
        instanceId="ticket-purchase-dev-demo"
        locale={safeLocale(query.get('locale'))}
        hostActions={{ onBack: () => undefined, onHistory: () => undefined, onTickets: () => undefined }}
      >
        <TicketPurchaseWidget eventId="demo-event" occurrenceId="demo-occurrence" />
      </TicketPurchaseProvider>
    );
  }

  if (!bridge || !init || bridgeState !== 'ready') {
    return <HandshakeState state={bridgeState} error={bridgeError} onRetry={() => {
      setBridge(null);
      setBridgeMessage(null);
      setInit(null);
      setBridgeError(null);
      setBridgeState('waiting');
      setRetry((attempt) => attempt + 1);
    }} />;
  }

  return (
    <BridgePurchase
      key={`${bridge.instanceId}:${resumeSession?.purchaseSessionId ?? init.session?.purchaseSessionId ?? ''}:${bootstrapCredential ?? ''}`}
      eventId={init.eventId}
      occurrenceId={route.occurrenceId}
      init={init}
      bridge={bridge}
      message={bridgeMessage}
      {...(resumeSession ? { activeSession: resumeSession } : {})}
      {...(bootstrapCredential ? { bootstrapCredential } : {})}
    />
  );
}

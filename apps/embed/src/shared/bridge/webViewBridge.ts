import { hostBridgeMessageSchema, widgetBridgeMessageSchema, createBridgeRequestId, type HostBridgeMessage, type WidgetBridgeMessage } from './protocol.js';

export type WebViewBridge = Readonly<{
  instanceId: string;
  send: <T extends WidgetBridgeMessage['type']>(type: T, payload: WidgetBridgePayloadMap[T]) => string;
  request: <T extends WidgetBridgeMessage['type']>(type: T, payload: WidgetBridgePayloadMap[T], timeoutMs?: number) => Promise<void>;
  dispose: () => void;
}>;

type WidgetBridgePayloadMap = {
  [T in WidgetBridgeMessage['type']]: Extract<WidgetBridgeMessage, { type: T }>['payload'];
};

export type WebViewBridgeOptions = Readonly<{
  instanceId: string;
  allowedOrigins?: readonly string[];
  onMessage: (message: HostBridgeMessage) => void;
}>;

export function createWebViewBridge(options: WebViewBridgeOptions): WebViewBridge {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const seenRequestIds = new Set<string>();
  const pendingRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: number }>();
  let disposed = false;

  function send<T extends WidgetBridgeMessage['type']>(
    type: T,
    payload: WidgetBridgePayloadMap[T],
  ): string {
    if (disposed) throw new Error('The WebView bridge has been disposed');
    const message = widgetBridgeMessageSchema.parse({
      version: 1,
      instanceId: options.instanceId,
      requestId: createBridgeRequestId(),
      type,
      payload,
    });
    const nativeHost = (window as Window & { ReactNativeWebView?: { postMessage(value: string): void } }).ReactNativeWebView;
    if (nativeHost) nativeHost.postMessage(JSON.stringify(message));
    else if (window.parent !== window) {
      const referrerOrigin = document.referrer ? (() => {
        try { return new URL(document.referrer).origin; } catch { return null; }
      })() : null;
      const targetOrigin = referrerOrigin && allowedOrigins.has(referrerOrigin)
        ? referrerOrigin
        : allowedOrigins.size === 1 ? [...allowedOrigins][0] : null;
      if (!targetOrigin) throw new Error('The trusted host origin is not configured');
      window.parent.postMessage(message, targetOrigin);
    }
    else throw new Error('No native bridge or allowlisted iframe host is available');
    return message.requestId;
  }

  function handleMessage(event: MessageEvent<unknown>) {
    const trustedNativeSource = event.source === window && (event.origin === window.location.origin || allowedOrigins.has(event.origin));
    const trustedFrameSource = event.source === window.parent && window.parent !== window && allowedOrigins.has(event.origin);
    if (!trustedNativeSource && !trustedFrameSource) return;

    let rawMessage = event.data;
    if (typeof rawMessage === 'string') {
      try { rawMessage = JSON.parse(rawMessage) as unknown; } catch { return; }
    }
    const parsed = hostBridgeMessageSchema.safeParse(rawMessage);
    if (!parsed.success) {
      const candidate = rawMessage as { version?: unknown; instanceId?: unknown } | null;
      if (candidate?.version !== undefined && candidate.version !== 1) {
        send('error', { code: 'unsupported_bridge_version', message: 'This widget supports bridge version 1.' });
      }
      return;
    }
    const message = parsed.data;
    if (message.instanceId !== options.instanceId || seenRequestIds.has(message.requestId)) return;
    seenRequestIds.add(message.requestId);
    if (seenRequestIds.size > 1_000) seenRequestIds.delete(seenRequestIds.values().next().value as string);

    if (message.type === 'ack') {
      const pending = pendingRequests.get(message.payload.requestId);
      if (pending) {
        window.clearTimeout(pending.timer);
        pendingRequests.delete(message.payload.requestId);
        if (message.payload.ok) pending.resolve();
        else pending.reject(new Error(message.payload.error ?? 'The host rejected the request'));
      }
    }
    options.onMessage(message);
  }

  window.addEventListener('message', handleMessage);

  function request<T extends WidgetBridgeMessage['type']>(
    type: T,
    payload: WidgetBridgePayloadMap[T],
    timeoutMs = 15_000,
  ): Promise<void> {
    const requestId = send(type, payload);
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('The host did not acknowledge the request in time'));
      }, timeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timer });
    });
  }

  return {
    instanceId: options.instanceId,
    send: send as WebViewBridge['send'],
    request: request as WebViewBridge['request'],
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('message', handleMessage);
      pendingRequests.forEach(({ reject, timer }) => {
        window.clearTimeout(timer);
        reject(new Error('The WebView bridge was disposed'));
      });
      pendingRequests.clear();
      seenRequestIds.clear();
    },
  };
}

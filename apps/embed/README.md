# Ticket purchase embed

`apps/embed` serves the purchase flow at `/buy/{occurrenceId}`. It contains the selection, contact, payment, and success steps only. The site that embeds it owns the surrounding header, footer, navigation, and page layout. `?locale=ru-RU` (or another supported locale) is a display setting; credentials must never be put in the URL. `?demo=1` loads a mock flow only in Vite development mode.

## WebView host contract

Before opening the route, configure these build-time variables:

| Variable | Purpose |
| --- | --- |
| `VITE_TICKET_PURCHASE_HOST_ORIGINS` | Comma-separated trusted browser/iframe host origins. Use exact HTTPS origins in production. |
| `VITE_TICKET_PURCHASE_API_ORIGINS` | Comma-separated allowed API origins. The current widget origin is also allowed. |
| `VITE_HALL_API_BASE_URL` | Default API base URL when the host does not provide one. |
| `VITE_TICKET_PURCHASE_PAYMENT_ORIGINS` | Exact HTTPS payment redirect origins accepted by the widget before it asks the host to open payment. |

The host waits for `ready`, then sends an envelope with `version: 1`, the received `instanceId`, a unique `requestId`, `type: "init"`, and an `init` payload. The URL occurrence ID must match `payload.occurrenceId`. The payload also carries `eventId`, optional `locale`, `theme`, `hostCapabilities`, and either a new-session `hostBootstrapCredential` or both `session.purchaseSessionId` and `session.sessionCredential`. A session credential is an opaque secret: keep it in the host's secure storage, send it only over the private bridge, and do not persist it in browser storage or logs.

Host messages supported by protocol v1 are `init`, `back`, `resume`, `authUpdated`, and `paymentReturned`. The widget acknowledges host requests with the same `requestId`. Widget messages include `ready`, `stateChanged`, `closeRequested`, `eventDetailsRequested`, `paymentRequested`, `sessionCreated`, `orderConfirmed`, `ticketsRequested`, `historyRequested`, `ack`, and `error`. `hostCapabilities` accepts `back`, `resume`, `payment`, `tickets`, `history`, and `eventDetails`; optional actions are not offered when the capability is absent.

The current native outbound adapter uses `window.ReactNativeWebView.postMessage`. Host-to-widget messages arrive as browser `message` events and must use the protocol envelope. The browser iframe adapter checks `event.source` and the exact configured origin. A native app must lock navigation to the configured widget origin, provide an origin-checked bridge, and independently enforce its own external payment URL allowlist. The widget also validates redirect actions against `VITE_TICKET_PURCHASE_PAYMENT_ORIGINS`; native enforcement remains required. After returning from payment, send `paymentReturned` with the order ID. The widget resumes the session and fetches the order from the API before accepting the result.

The widget currently has a concrete React Native WebView outbound adapter. Android WebView and iOS `WKWebView` host adapters, bridge injection details, and physical-device keyboard/back/resume behavior still require native integration and device verification. A web build also needs SPA fallback hosting so a direct `/buy/{occurrenceId}` request and reload reach the app entry point.

## React composition

Install the package dependencies and include its styles once in the host application:

```tsx
import '@hall-platform/ticket-purchase/styles.css';
import {
  TicketPurchaseProvider,
  TicketPurchaseWidget,
} from '@hall-platform/ticket-purchase';
import { createHttpPurchaseDataSource } from '@hall-platform/ticket-purchase/http';

const dataSource = createHttpPurchaseDataSource({
  baseURL: 'https://tickets.example.com',
  getSessionCredential: (purchaseSessionId) =>
    sessionStore.getCredential(purchaseSessionId),
});

export function BuyTickets() {
  return (
    <TicketPurchaseProvider
      dataSource={dataSource}
      locale="ru-RU"
      hostActions={{
        onBack: () => history.back(),
        onPaymentRequested: (attempt) => paymentHost.open(attempt),
      }}
    >
      <TicketPurchaseWidget eventId="event-17" occurrenceId="occurrence-42" />
    </TicketPurchaseProvider>
  );
}
```

The widget provides the full flow. For a custom page, use the same provider and controller with `TicketSelectionStep`, `ContactDetailsForm`, `PaymentStep`, `PurchaseSuccess`, and `useTicketPurchase`. Call `usePurchaseSessionResume(eventId, occurrenceId)` in the composed page so a stored server session and an active order are restored on reload. The example in `src/examples/TicketPurchaseCompositionExample.tsx` shows both the full widget and a component composition.

`hostActions` are owned by the integrating app. In particular, the host opens the payment attempt, navigates to order history or tickets, and handles event-detail navigation; the widget does not invent fallback URLs.

## Non-React hosts

For a host with an existing DOM element, import the separate DOM entry point:

```ts
import '@hall-platform/ticket-purchase/styles.css';
import { createTicketPurchaseEmbed } from '@hall-platform/ticket-purchase/dom';

const widget = createTicketPurchaseEmbed(document.querySelector('#buy-tickets')!, {
  eventId: 'event-17',
  occurrenceId: 'occurrence-42',
  dataSource,
  locale: 'ru-RU',
  hostActions,
});

// Reconfigure when host-owned options change.
widget.update({ eventId: 'event-17', occurrenceId: 'occurrence-43', dataSource, locale: 'ru-RU', hostActions });

// Call when removing the host element.
widget.dispose();
```

The host owns the `PurchaseDataSource`. Changing occurrence, event, source, or instance identity starts a fresh widget context; theme and locale updates retain the current context. `dispose()` unmounts React and removes widget subscriptions.

## API and delivery status

The HTTP source consumes the buyer v2 schemas and routes published in `libs/api-contracts/openapi.json`. That OpenAPI file is the contract proposal for backend implementation; it does not prove the endpoints or storage transactions are deployed. Payment, order confirmation, holds, email verification, and ticket delivery remain server-authoritative. The development demo is mock-only and cannot validate a real purchase.

Large-hall geometry contracts and a verified block loader are present in the shared libraries, but the current purchase screen still loads the compatible full seat map. Partial geometry has not yet been connected to the renderer, and 50,000-seat performance has not been measured. No Android WebView or iOS WKWebView device acceptance has been completed.

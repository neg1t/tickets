import '@hall-platform/ticket-purchase/styles.css';
import {
  Button,
  ContactDetailsForm,
  PaymentStep,
  PurchaseSuccess,
  TicketPurchaseProvider,
  TicketPurchaseWidget,
  TicketSelectionStep,
  PurchaseLayout,
  usePurchaseSessionResume,
  useTicketPurchase,
} from '@hall-platform/ticket-purchase';
import type { BuyerOrder } from '@hall-platform/api-contracts';
import { useState } from 'react';
import { createMockPurchaseDataSource } from '../shared/demo/mockPurchaseDataSource.js';

const eventId = 'demo-event';
const occurrenceId = 'demo-occurrence';

function ComposedPurchasePage() {
  const purchase = useTicketPurchase();
  const resume = usePurchaseSessionResume(eventId, occurrenceId);
  const [confirmedOrder, setConfirmedOrder] = useState<BuyerOrder | null>(null);

  if (purchase.step === 'selection' && resume.status === 'loading') return <PurchaseLayout loading />;
  if (purchase.step === 'selection' && resume.status === 'error') {
    return <PurchaseLayout><p role="alert">{resume.error}</p><Button tone="secondary" onClick={resume.retry}>Retry session recovery</Button></PurchaseLayout>;
  }
  if (purchase.step === 'selection') {
    return <TicketSelectionStep eventId={eventId} occurrenceId={occurrenceId} />;
  }
  if (purchase.step === 'contacts') return <ContactDetailsForm />;
  if (purchase.step === 'success' && confirmedOrder) return <PurchaseSuccess order={confirmedOrder} />;
  return <PaymentStep onOrderConfirmed={setConfirmedOrder} />;
}

/** Side-by-side public API examples: ready-made flow and the same steps composed by the host. */
export function TicketPurchaseCompositionExample() {
  return (
    <main className="purchase-composition-example">
      <section aria-label="Готовый виджет покупки">
        <TicketPurchaseProvider
          dataSource={createMockPurchaseDataSource()}
          instanceId="purchase-widget-demo"
          theme={{ accent: '#bc2d9b' }}
          hostActions={{ onBack: () => undefined, onHistory: () => undefined }}
        >
          <TicketPurchaseWidget eventId={eventId} occurrenceId={occurrenceId} />
        </TicketPurchaseProvider>
      </section>
      <section aria-label="Покупка, собранная из компонентов">
        <TicketPurchaseProvider
          dataSource={createMockPurchaseDataSource()}
          instanceId="purchase-composed-demo"
          theme={{ accent: '#306c4a' }}
          hostActions={{ onBack: () => undefined, onHistory: () => undefined }}
        >
          <ComposedPurchasePage />
        </TicketPurchaseProvider>
      </section>
    </main>
  );
}

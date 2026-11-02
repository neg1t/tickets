import { useCallback, useRef, useState } from 'react';
import type { BuyerOrder, BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import type { ReactNode } from 'react';
import { useTicketPurchase } from './TicketPurchaseProvider.js';
import { ContactDetailsForm } from './ui/ContactDetailsForm.js';
import { PaymentStep } from './ui/PaymentStep.js';
import { PurchaseLayout } from './ui/PurchaseLayout.js';
import { PurchaseSuccess } from './ui/PurchaseSuccess.js';
import { TicketSelectionStep } from './ui/TicketSelectionStep.js';
import { usePurchaseSessionResume } from './model/usePurchaseSessionResume.js';
import { useTicketPurchaseController } from './model/useTicketPurchase.js';
import { Button } from '@hall-platform/ui';

export type TicketPurchaseWidgetProps = Readonly<{
  eventId?: string;
  occurrenceId?: string;
  occurrence?: BuyerOccurrenceSummary;
  mapHeight?: number;
  loading?: boolean;
  error?: string | null;
  className?: string;
  headerContent?: ReactNode;
  /** Optional custom content keeps the component usable as a layout shell. */
  children?: ReactNode;
}>;

function PurchaseFlow({ eventId, occurrenceId, mapHeight = 420 }: { eventId: string; occurrenceId: string; mapHeight?: number }) {
  const purchase = useTicketPurchase();
  const { snapshot } = useTicketPurchaseController();
  const resume = usePurchaseSessionResume(eventId, occurrenceId);
  const onOrderConfirmed = purchase.hostActions.onOrderConfirmed;
  const [confirmedOrder, setConfirmedOrder] = useState<BuyerOrder | null>(null);
  const reportedOrderId = useRef<string | null>(null);
  const handleOrderConfirmed = useCallback((order: BuyerOrder) => {
    setConfirmedOrder(order);
    if (reportedOrderId.current === order.id) return;
    reportedOrderId.current = order.id;
    try {
      void Promise.resolve(onOrderConfirmed?.(order)).catch(() => undefined);
    } catch {
      // The purchase is already confirmed by the server; host notification failure must not hide it.
    }
  }, [onOrderConfirmed]);

  if (purchase.step === 'selection' && resume.status === 'loading') {
    return <PurchaseLayout {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})} loading />;
  }
  if (purchase.step === 'selection' && resume.status === 'error') {
    const english = purchase.locale.toLowerCase().startsWith('en');
    return (
      <PurchaseLayout {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})}>
        <section className="tp-selection-state" role="alert">
          <p>{resume.error}</p>
          <Button tone="secondary" onClick={resume.retry}>
            {english ? 'Retry session recovery' : 'Повторить восстановление сессии'}
          </Button>
        </section>
      </PurchaseLayout>
    );
  }

  if (purchase.step === 'selection') {
    return <TicketSelectionStep eventId={eventId} occurrenceId={occurrenceId} mapHeight={mapHeight} />;
  }
  if (purchase.step === 'contacts') return <ContactDetailsForm />;
  if (purchase.step === 'success' && confirmedOrder) return <PurchaseSuccess order={confirmedOrder} />;
  return <PaymentStep onOrderConfirmed={handleOrderConfirmed} />;
}

/** Convenience composition for the complete flow; host actions and CSS remain host-owned. */
export function TicketPurchaseWidget({
  eventId,
  occurrenceId,
  occurrence,
  mapHeight,
  loading = false,
  error = null,
  className = '',
  headerContent,
  children,
}: TicketPurchaseWidgetProps) {
  const purchase = useTicketPurchase();

  if (children !== undefined) {
    return (
      <PurchaseLayout
        {...(occurrence ? { occurrence } : {})}
        loading={loading}
        error={error}
        className={className}
        headerContent={headerContent}
      >
        {children}
      </PurchaseLayout>
    );
  }

  if (eventId && occurrenceId) {
    return <PurchaseFlow eventId={eventId} occurrenceId={occurrenceId} {...(mapHeight === undefined ? {} : { mapHeight })} />;
  }

  return (
    <PurchaseLayout
      {...(occurrence ? { occurrence } : {})}
      loading={loading}
      error={error}
      className={className}
      headerContent={headerContent}
    >
      <p className="tp-layout__error" role="status">
        {purchase.locale.toLowerCase().startsWith('en')
          ? 'Pass eventId and occurrenceId to render the purchase flow.'
          : 'Передайте eventId и occurrenceId, чтобы открыть процесс покупки.'}
      </p>
    </PurchaseLayout>
  );
}

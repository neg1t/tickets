import '@hall-platform/ticket-purchase/styles.css';
import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import {
  PurchaseLayout,
  TicketPurchaseProvider,
  TicketPurchaseWidget,
  useTicketPurchase,
} from '@hall-platform/ticket-purchase';
import { createMockPurchaseDataSource } from '../shared/demo/mockPurchaseDataSource.js';

const musicEvent: BuyerOccurrenceSummary = {
  occurrenceId: 'demo-music-show',
  eventId: 'demo-music',
  title: 'Billie Eilish',
  startsAt: '2026-09-04T20:00:00+04:00',
  timeZone: 'Asia/Yerevan',
  venue: { name: 'Дом камерной музыки имени Комитаса', city: 'Ереван' },
  salesStatus: 'open',
  currency: 'AMD',
  capabilities: { seats: true, generalAdmission: true },
};
const theaterEvent: BuyerOccurrenceSummary = {
  occurrenceId: 'demo-theater-show',
  eventId: 'demo-theater',
  title: 'Вечер камерной музыки',
  startsAt: '2026-09-05T19:00:00+04:00',
  timeZone: 'Asia/Yerevan',
  venue: { name: 'Зал Арама Хачатуряна', city: 'Ереван' },
  salesStatus: 'open',
  currency: 'AMD',
  capabilities: { seats: true, generalAdmission: false },
};

function ExampleWidget({
  occurrence,
  label,
  useWidgetShell = false,
}: {
  readonly occurrence: BuyerOccurrenceSummary;
  readonly label: string;
  readonly useWidgetShell?: boolean;
}) {
  const purchase = useTicketPurchase();
  const content = (
    <section className="tp-example-step" aria-label={`${label} example step`}>
      <p>{purchase.step}</p>
      <button type="button" onClick={() => purchase.setStep('contacts')}>
        Перейти к контактам: {label}
      </button>
      <button type="button" onClick={() => purchase.hostActions.onHistory?.()}>
        История: {label}
      </button>
    </section>
  );
  return useWidgetShell ? (
    <TicketPurchaseWidget occurrence={occurrence}>{content}</TicketPurchaseWidget>
  ) : (
    <PurchaseLayout occurrence={occurrence}>{content}</PurchaseLayout>
  );
}

/** Consumer example showing both the ready-made widgets and manual composition. */
export function TicketPurchaseCompositionExample() {
  return (
    <main className="purchase-composition-example">
      <TicketPurchaseProvider
        dataSource={createMockPurchaseDataSource()}
        instanceId="composition-music"
        theme={{ accent: '#bc2d9b' }}
        hostActions={{ onBack: () => undefined, onHistory: () => undefined }}
      >
        <ExampleWidget occurrence={musicEvent} label="music" />
      </TicketPurchaseProvider>
      <TicketPurchaseProvider
        dataSource={createMockPurchaseDataSource()}
        instanceId="composition-theater"
        theme={{ accent: '#306c4a' }}
        hostActions={{ onBack: () => undefined, onHistory: () => undefined }}
      >
        <ExampleWidget occurrence={theaterEvent} label="theater" useWidgetShell />
      </TicketPurchaseProvider>
    </main>
  );
}


import { useMemo, useState } from 'react';
import { layoutDocumentSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json';
import {
  SeatView,
  type SeatSelectionItem,
  type SeatViewData,
} from '@hall-platform/seat-view';

const sampleDocument = layoutDocumentSchema.parse(smallTheater.document);
const sampleLayout = {
  hallName: sampleDocument.hall.name,
  snapshot: sampleDocument.snapshot,
};

export function EmbedPage() {
  const [selection, setSelection] = useState<SeatSelectionItem[]>([]);
  const [checkoutMessage, setCheckoutMessage] = useState('');
  const availability = useMemo(
    () => ({
      seats: Object.fromEntries(
        sampleLayout.snapshot.seats.map((seat, index) => [
          seat.id,
          index % 29 === 0 ? ('sold' as const) : ('available' as const),
        ]),
      ),
    }),
    [],
  );
  const prices = useMemo(
    () => ({
      seats: Object.fromEntries(
        sampleLayout.snapshot.seats.map((seat) => {
          const zone = sampleLayout.snapshot.zones.find(
            (item) => item.id === seat.zoneId,
          );
          const zoneIndex = zone
            ? sampleLayout.snapshot.zones.indexOf(zone)
            : 0;
          const categories = [
            { amount: 1500, category: 'Стандарт' },
            { amount: 2200, category: 'Комфорт' },
            { amount: 3000, category: 'Премиум' },
          ];
          const category = categories[zoneIndex % categories.length] ?? {
            amount: 1500,
            category: 'Стандарт',
          };
          return [seat.id, { ...category, currency: 'RUB' }];
        }),
      ),
    }),
    [],
  );

  async function handleCheckout(data: SeatViewData) {
    const count = data.selection.reduce(
      (total, item) => total + (item.kind === 'seat' ? 1 : item.quantity),
      0,
    );
    setCheckoutMessage(
      `Демо: выбрано мест — ${count}. Подключите callback onCheckout к API бронирования.`,
    );
  }

  return (
    <main className="embed-host">
      <header className="embed-host-header">
        <p className="embed-host-eyebrow">Hall Platform · SDK example</p>
        <h1>Бронирование мест</h1>
        <p>
          Рабочий пример покупательской схемы. Выбор контролируется
          host-приложением; бронирование в этом демо не отправляется.
        </p>
      </header>
      <SeatView
        layout={sampleLayout}
        occurrenceId="embed-sample-show-2026-10-28"
        availability={availability}
        availabilityRevision={1}
        prices={prices}
        selection={selection}
        locale="ru-RU"
        onSelectionChange={setSelection}
        onBuyClick={handleCheckout}
      />
      {checkoutMessage && <p role="status">{checkoutMessage}</p>}
    </main>
  );
}

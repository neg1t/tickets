import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import { getDemoAvailability, getDemoTotal } from '../model/demoBooking.js';
import type { DemoOccurrence, DemoOrder } from '../model/demoBooking.js';
import './buyer-page.css';

type BuyerPageProps = {
  occurrence: DemoOccurrence | null;
  activeHoldId: string | null;
  receipt: DemoOrder | null;
  error: string | null;
  selection: SeatSelectionItem[];
  onBack: () => void;
  onSelectionChange: (items: SeatSelectionItem[]) => void;
  onHold: (id: string, selection: SeatSelectionItem[]) => Promise<unknown>;
  onConfirm: (id: string, holdId: string) => Promise<unknown>;
  onCancel: (id: string, holdId: string) => Promise<unknown>;
  onReopen: (id: string) => Promise<unknown>;
};

export function BuyerPage(props: BuyerPageProps) {
  const occurrence = props.occurrence;
  const holdId = props.activeHoldId;
  return (
    <main className="studio-buyer-page">
      <header className="studio-buyer-top"><button type="button" onClick={props.onBack}>‹ Все залы</button><span>Hall Studio</span></header>
      <div className="studio-buyer-content"><span className="studio-eyebrow">Выбор билетов</span><h1>Покупательская схема</h1>
        {!occurrence ? <p role="status">Загрузка мероприятия…</p> : <>
          <div className="studio-buyer-heading"><div><h2>{occurrence.title}</h2><p>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(occurrence.startsAt))} · {occurrence.layout.hallName}</p></div><span>Схема зала</span></div>
          {props.error && <div role="alert" className="studio-alert"><strong>Проверьте выбор.</strong> {props.error}</div>}
          {props.receipt ? (
            <section className="studio-buyer-result" role="status"><h2>Покупка подтверждена</h2><p>Заказ № {props.receipt.id}</p><p>Билетов: {props.receipt.selection.reduce((sum, item) => sum + (item.kind === 'seat' ? 1 : item.quantity), 0)}</p><strong>Итого: {getDemoTotal(occurrence, props.receipt.selection).toLocaleString('ru-RU')} ₽</strong><button type="button" onClick={() => void props.onReopen(occurrence.id)}>Выбрать ещё билеты</button></section>
          ) : holdId ? (
            <section className="studio-buyer-result" aria-label="Оформление заказа"><h2>Подтверждение покупки</h2><p>Билеты удерживаются 5 минут. Оплата в демо-режиме не требуется.</p><strong>Итого: {getDemoTotal(occurrence, occurrence.holds.find((hold) => hold.id === holdId)?.selection ?? []).toLocaleString('ru-RU')} ₽</strong><div className="studio-buyer-result-actions"><button type="button" onClick={() => void props.onConfirm(occurrence.id, holdId)}>Подтвердить покупку</button><button type="button" onClick={() => void props.onCancel(occurrence.id, holdId)}>Отменить</button></div></section>
          ) : (
            <SeatView layout={occurrence.layout} occurrenceId={occurrence.id} availability={getDemoAvailability(occurrence)} prices={occurrence.prices} selection={props.selection} onSelectionChange={props.onSelectionChange} onBuyClick={(data) => props.onHold(data.occurrenceId, [...data.selection]).then(() => undefined)} />
          )}
        </>}
      </div>
    </main>
  );
}

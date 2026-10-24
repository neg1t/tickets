import { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import { getDemoAvailability, getDemoTotal } from '../model/demoBooking.js';
import type { DemoOccurrence, DemoOrder } from '../model/demoBooking.js';
import { cancelDemoFx, confirmDemoFx } from '../model/dashboard.model.js';
import './buyer-page.css';

const englishText: Record<string, string> = {
  'Все залы': 'All halls',
  'Выбор билетов': 'Choose tickets',
  'Покупательская схема': 'Seat selection',
  'Загрузка мероприятия…': 'Loading event…',
  'Схема зала': 'Hall layout',
  'Проверьте выбор.': 'Please check your selection.',
  'Время удержания истекло. Выберите билеты заново.':
    'Your hold expired. Please choose tickets again.',
  'Покупка подтверждена': 'Purchase confirmed',
  'Заказ №': 'Order #',
  'Билетов:': 'Tickets:',
  'Итого:': 'Total:',
  'Выбрать ещё билеты': 'Choose more tickets',
  'Оформление заказа': 'Checkout',
  'Подтверждение покупки': 'Confirm purchase',
  'Оплата в демо-режиме не требуется.': 'No payment is required in demo mode.',
  'Осталось времени:': 'Time remaining:',
  'Подтверждение…': 'Confirming…',
  'Подтвердить покупку': 'Confirm purchase',
  'Отмена…': 'Cancelling…',
  Отменить: 'Cancel',
  'Некорректный выбор билетов': 'Invalid ticket selection',
  'Повторное место в заказе': 'A seat was selected more than once',
  'Некорректное количество билетов': 'Invalid ticket quantity',
  'Цена билета недоступна': 'Ticket price is unavailable',
  'Нельзя складывать билеты разных валют':
    'Tickets with different currencies cannot be combined',
  'Не удалось рассчитать стоимость билетов': 'Unable to calculate ticket total',
  'Выберите места или билеты': 'Choose seats or tickets',
  'Место больше недоступно': 'This seat is no longer available',
  'Недостаточно билетов в секторе': 'Not enough tickets remain in this section',
  'Удержание недоступно в этой вкладке':
    'This hold is not available in this tab',
  'Время удержания истекло. Выберите билеты заново':
    'Your hold expired. Please choose tickets again',
  'Демо-мероприятие не найдено': 'Demo event was not found',
};

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
  const [locale, setLocale] = useState<'ru-RU' | 'en-US'>('ru-RU');
  const tr = (russian: string) =>
    locale === 'en-US' ? (englishText[russian] ?? russian) : russian;
  const money = (amount: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'RUB',
    }).format(amount);
  const occurrence = props.occurrence;
  const onCancel = props.onCancel;
  const holdId = props.activeHoldId;
  const hold = occurrence?.holds.find((item) => item.id === holdId);
  const [now, setNow] = useState<number | null>(null);
  const [expiredOccurrenceId, setExpiredOccurrenceId] = useState<string | null>(
    null,
  );
  const expiryRequested = useRef<string | null>(null);
  const [confirmPending, cancelPending] = useUnit([
    confirmDemoFx.pending,
    cancelDemoFx.pending,
  ]);
  const remaining =
    hold && now !== null
      ? Math.max(0, Math.ceil((hold.expiresAt - now) / 1000))
      : 0;

  useEffect(() => {
    const updateClock = () => setNow(Date.now());
    const initial = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (
      !occurrence ||
      !hold ||
      now === null ||
      remaining > 0 ||
      expiryRequested.current === hold.id
    )
      return;
    expiryRequested.current = hold.id;
    setExpiredOccurrenceId(occurrence.id);
    void onCancel(occurrence.id, hold.id).catch(() => {
      expiryRequested.current = null;
    });
  }, [occurrence, hold, now, remaining, onCancel]);

  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return (
    <main className="studio-buyer-page">
      <header className="studio-buyer-top">
        <button type="button" onClick={props.onBack}>
          ‹ {tr('Все залы')}
        </button>
        <span>Hall Studio</span>
      </header>
      <div className="studio-buyer-content">
        <div className="studio-buyer-locale" role="group" aria-label="Language">
          <button
            type="button"
            aria-pressed={locale === 'ru-RU'}
            onClick={() => setLocale('ru-RU')}
          >
            Русский
          </button>
          <button
            type="button"
            aria-pressed={locale === 'en-US'}
            onClick={() => setLocale('en-US')}
          >
            English
          </button>
        </div>
        <span className="studio-eyebrow">{tr('Выбор билетов')}</span>
        <h1>{tr('Покупательская схема')}</h1>
        {!occurrence ? (
          <p role="status">{tr('Загрузка мероприятия…')}</p>
        ) : (
          <>
            <div className="studio-buyer-heading">
              <div>
                <h2>{occurrence.title}</h2>
                <p>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  }).format(new Date(occurrence.startsAt))}{' '}
                  · {occurrence.layout.hallName}
                </p>
              </div>
              <span>{tr('Схема зала')}</span>
            </div>
            {props.error && (
              <div role="alert" className="studio-alert">
                <strong>{tr('Проверьте выбор.')}</strong> {tr(props.error)}
              </div>
            )}
            {expiredOccurrenceId === occurrence.id &&
              !hold &&
              !props.receipt && (
                <div role="status" className="studio-alert">
                  {tr('Время удержания истекло. Выберите билеты заново.')}
                </div>
              )}
            {props.receipt ? (
              <section className="studio-buyer-result" role="status">
                <h2>{tr('Покупка подтверждена')}</h2>
                <p>
                  {tr('Заказ №')} {props.receipt.id}
                </p>
                <p>
                  {tr('Билетов:')}{' '}
                  {props.receipt.selection.reduce(
                    (sum, item) =>
                      sum + (item.kind === 'seat' ? 1 : item.quantity),
                    0,
                  )}
                </p>
                <strong>
                  {tr('Итого:')}{' '}
                  {money(getDemoTotal(occurrence, props.receipt.selection))}
                </strong>
                <button
                  type="button"
                  onClick={() => void props.onReopen(occurrence.id)}
                >
                  {tr('Выбрать ещё билеты')}
                </button>
              </section>
            ) : hold ? (
              <section
                className="studio-buyer-result"
                aria-label={tr('Оформление заказа')}
              >
                <h2>{tr('Подтверждение покупки')}</h2>
                <p>{tr('Оплата в демо-режиме не требуется.')}</p>
                <p className="studio-buyer-countdown">
                  {tr('Осталось времени:')}{' '}
                  <time role="timer" aria-live="off">
                    {minutes}:{seconds}
                  </time>
                </p>
                <strong>
                  {tr('Итого:')}{' '}
                  {money(getDemoTotal(occurrence, hold.selection))}
                </strong>
                <div className="studio-buyer-result-actions">
                  <button
                    type="button"
                    disabled={
                      confirmPending || cancelPending || remaining === 0
                    }
                    onClick={() =>
                      void props
                        .onConfirm(occurrence.id, hold.id)
                        .catch(() => undefined)
                    }
                  >
                    {tr(
                      confirmPending ? 'Подтверждение…' : 'Подтвердить покупку',
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={confirmPending || cancelPending}
                    onClick={() =>
                      void props
                        .onCancel(occurrence.id, hold.id)
                        .catch(() => undefined)
                    }
                  >
                    {tr(cancelPending ? 'Отмена…' : 'Отменить')}
                  </button>
                </div>
              </section>
            ) : (
              <SeatView
                layout={occurrence.layout}
                occurrenceId={occurrence.id}
                locale={locale}
                availability={getDemoAvailability(occurrence)}
                prices={occurrence.prices}
                selection={props.selection}
                onSelectionChange={props.onSelectionChange}
                onBuyClick={(data) => {
                  setExpiredOccurrenceId(null);
                  return props
                    .onHold(data.occurrenceId, [...data.selection])
                    .then(() => undefined);
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

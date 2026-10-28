import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import { formatPricingMoney } from '@hall-platform/domain';
import { SeatView, type SeatSelectionItem } from '@hall-platform/seat-view';
import { getDemoAvailability } from '../model/demoBooking.js';
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
  'Сумма старого демо-заказа не сохранена.': 'The total was not saved for this legacy demo order.',
  'Старые удержания отменены после обновления цен. Выберите билеты заново.':
    'Legacy holds were cancelled after the pricing update. Please choose tickets again.',
};

function translate(locale: string, russian: string): string {
  return locale === 'en-US' ? (englishText[russian] ?? russian) : russian;
}

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

function ActiveHoldPanel(props: {
  occurrence: DemoOccurrence;
  hold: NonNullable<DemoOccurrence['holds'][number]>;
  locale: string;
  confirmPending: boolean;
  cancelPending: boolean;
  onExpired: (occurrenceId: string) => void;
  onConfirm: (occurrenceId: string, holdId: string) => Promise<unknown>;
  onCancel: (occurrenceId: string, holdId: string) => Promise<unknown>;
}) {
  const [now, setNow] = useState<number | null>(null);
  const expiryRequested = useRef<string | null>(null);
  const remaining =
    now === null
      ? 0
      : Math.max(0, Math.ceil((props.hold.expiresAt - now) / 1000));

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
      now === null ||
      remaining > 0 ||
      expiryRequested.current === props.hold.id
    )
      return;
    expiryRequested.current = props.hold.id;
    props.onExpired(props.occurrence.id);
    void props.onCancel(props.occurrence.id, props.hold.id).catch(() => {
      expiryRequested.current = null;
    });
  }, [
    now,
    remaining,
    props.hold.id,
    props.occurrence.id,
    props.onCancel,
    props.onExpired,
  ]);

  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  const quote = props.hold.quote;
  return (
    <section
      className="studio-buyer-result"
      aria-label={translate(props.locale, 'Оформление заказа')}
    >
      <h2>{translate(props.locale, 'Подтверждение покупки')}</h2>
      <p>{translate(props.locale, 'Оплата в демо-режиме не требуется.')}</p>
      <p className="studio-buyer-countdown">
        {translate(props.locale, 'Осталось времени:')}{' '}
        <time role="timer" aria-live="off">
          {minutes}:{seconds}
        </time>
      </p>
      <strong>
        {translate(props.locale, 'Итого:')} {formatPricingMoney(quote.total, props.locale)}
      </strong>
      <div className="studio-buyer-result-actions">
        <button
          type="button"
          disabled={
            props.confirmPending || props.cancelPending || remaining === 0
          }
          onClick={() =>
            void props
              .onConfirm(props.occurrence.id, props.hold.id)
              .catch(() => undefined)
          }
        >
          {translate(
            props.locale,
            props.confirmPending ? 'Подтверждение…' : 'Подтвердить покупку',
          )}
        </button>
        <button
          type="button"
          disabled={props.confirmPending || props.cancelPending}
          onClick={() =>
            void props
              .onCancel(props.occurrence.id, props.hold.id)
              .catch(() => undefined)
          }
        >
          {translate(
            props.locale,
            props.cancelPending ? 'Отмена…' : 'Отменить',
          )}
        </button>
      </div>
    </section>
  );
}

function AvailabilitySeatMap(props: {
  occurrence: DemoOccurrence;
  locale: string;
  selection: SeatSelectionItem[];
  onSelectionChange: (items: SeatSelectionItem[]) => void;
  onBuy: (
    occurrenceId: string,
    selection: SeatSelectionItem[],
  ) => Promise<unknown>;
  onBuyStarted: () => void;
}) {
  const [expiryRevision, setExpiryRevision] = useState(0);
  const availability = useMemo(
    () => getDemoAvailability(props.occurrence),
    [props.occurrence, expiryRevision],
  );

  useEffect(() => {
    const refresh = () => setExpiryRevision((revision) => revision + 1);
    const now = Date.now();
    const nextExpiry = props.occurrence.holds.reduce<number | null>(
      (nearest, hold) =>
        hold.expiresAt > now && (nearest === null || hold.expiresAt < nearest)
          ? hold.expiresAt
          : nearest,
      null,
    );
    const expiryTimer =
      nextExpiry === null
        ? undefined
        : window.setTimeout(refresh, Math.max(0, nextExpiry - now + 1));
    document.addEventListener('visibilitychange', refresh);
    return () => {
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [props.occurrence, expiryRevision]);

  return (
    <SeatView
      layout={props.occurrence.layout}
      occurrenceId={props.occurrence.id}
      locale={props.locale}
      availability={availability}
      prices={props.occurrence.prices}
      selection={props.selection}
      onSelectionChange={props.onSelectionChange}
      onBuyClick={(data) => {
        props.onBuyStarted();
        return props
          .onBuy(data.occurrenceId, [...data.selection])
          .then(() => undefined);
      }}
    />
  );
}

export function BuyerPage(props: BuyerPageProps) {
  const [locale, setLocale] = useState<'ru-RU' | 'en-US'>('ru-RU');
  const tr = (russian: string) => translate(locale, russian);
  const occurrence = props.occurrence;
  const holdId = props.activeHoldId;
  const hold = occurrence?.holds.find((item) => item.id === holdId);
  const [expiredOccurrenceId, setExpiredOccurrenceId] = useState<string | null>(
    null,
  );
  const markHoldExpired = useCallback((id: string) => {
    setExpiredOccurrenceId(id);
  }, []);
  const clearExpiredNotice = useCallback(() => {
    setExpiredOccurrenceId(null);
  }, []);
  const [confirmPending, cancelPending] = useUnit([
    confirmDemoFx.pending,
    cancelDemoFx.pending,
  ]);
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
            {occurrence.legacyQuoteNotice && (
              <div role="status" className="studio-alert">
                {tr('Старые удержания отменены после обновления цен. Выберите билеты заново.')}
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
                {props.receipt.quote ? (
                  <strong>
                    {tr('Итого:')} {formatPricingMoney(props.receipt.quote.total, locale)}
                  </strong>
                ) : (
                  <p>{tr('Сумма старого демо-заказа не сохранена.')}</p>
                )}
                <button
                  type="button"
                  onClick={() => void props.onReopen(occurrence.id)}
                >
                  {tr('Выбрать ещё билеты')}
                </button>
              </section>
            ) : hold ? (
              <ActiveHoldPanel
                occurrence={occurrence}
                hold={hold}
                locale={locale}
                confirmPending={confirmPending}
                cancelPending={cancelPending}
                onExpired={markHoldExpired}
                onConfirm={props.onConfirm}
                onCancel={props.onCancel}
              />
            ) : (
              <AvailabilitySeatMap
                occurrence={occurrence}
                locale={locale}
                selection={props.selection}
                onSelectionChange={props.onSelectionChange}
                onBuyStarted={clearExpiredNotice}
                onBuy={props.onHold}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BuyerHold, BuyerSelection } from '@hall-platform/api-contracts';
import { mapV2BuyerPricesToSeatView } from '@hall-platform/api-axios';
import {
  SeatMap,
  SeatSelectionProvider,
  useSeatSelection,
  type SeatAvailabilityMap,
  type PublishedHallLayout,
} from '@hall-platform/seat-view';
import { Button } from '@hall-platform/ui';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';
import { useTicketPurchaseController } from '../model/useTicketPurchase.js';
import type { PurchaseControllerSnapshot } from '../model/createPurchaseController.js';
import { mapBuyerAvailabilityToSeatView } from '../model/purchaseEffects.js';
import { PurchaseLayout } from './PurchaseLayout.js';
import { OccurrenceSelector } from './OccurrenceSelector.js';
import { OrderSummary } from './OrderSummary.js';
import { SelectedTicketsList } from './SelectedTicketsList.js';
import { PurchaseDialog } from './PurchaseDialog.js';

export type TicketSelectionStepProps = Readonly<{
  eventId: string;
  occurrenceId: string;
  mapHeight?: number;
  onReserved?: (hold: BuyerHold) => void;
}>;

function makeFormatter(locale: string, currency: string) {
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return (minor: number | null) => minor === null ? '—' : formatter.format(minor / (10 ** digits));
  } catch {
    const numberFormatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (minor: number | null) => minor === null ? '—' : `${numberFormatter.format(minor / 100)} ${currency}`;
  }
}

function ErrorState({
  title,
  message,
  retry,
  locale,
}: {
  title: string;
  message?: string | null;
  retry?: () => void;
  locale: string;
}) {
  return (
    <section className="tp-selection-state" role={message ? 'alert' : 'status'}>
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {retry ? (
        <Button tone="secondary" onClick={retry}>
          {locale.toLowerCase().startsWith('en') ? 'Try again' : 'Попробовать снова'}
        </Button>
      ) : null}
    </section>
  );
}

function SelectionIssueText({ code, locale }: { code: string | null; locale: string }): string | null {
  if (!code) return null;
  const english = locale.toLowerCase().startsWith('en');
  const messages: Record<string, readonly [string, string]> = {
    unknown_seat: ['Место не найдено в схеме зала.', 'This seat is not part of the hall map.'],
    unavailable_seat: ['Это место уже недоступно.', 'This seat is no longer available.'],
    unavailable_zone: ['В этом секторе больше нет доступных билетов.', 'There are no tickets left in this section.'],
    quantity_exceeds_availability: ['Количество превышает остаток в секторе.', 'Quantity is higher than the remaining section capacity.'],
    quantity_exceeds_limit: ['Превышено ограничение билетов на заказ.', 'The per order ticket limit was exceeded.'],
    invalid_quantity: ['Укажите целое количество билетов.', 'Enter a whole number of tickets.'],
    missing_price: ['Для выбранного билета не найдена цена.', 'The selected ticket has no price.'],
    invalid_price: ['Цена билета указана некорректно.', 'The ticket price is invalid.'],
    mixed_currencies: ['В заказе не могут смешиваться разные валюты.', 'An order cannot combine different currencies.'],
    total_overflow: ['Итог заказа превышает допустимое значение.', 'The order total is too large.'],
  };
  return messages[code]?.[english ? 1 : 0] ?? (english ? 'Review the selected tickets.' : 'Проверьте выбранные билеты.');
}

function AccessibleTicketPicker({
  layout,
  availability,
  prices,
  locale,
  selection,
  toggleSeat,
  setGeneralAdmissionQuantity,
  locked,
}: {
  layout: PublishedHallLayout;
  availability: SeatAvailabilityMap;
  prices: NonNullable<ReturnType<typeof useTicketPurchaseController>['snapshot']['prices']>;
  locale: string;
  selection: readonly BuyerSelection[];
  toggleSeat: (seatId: string) => boolean;
  setGeneralAdmissionQuantity: (zoneId: string, value: string | number) => boolean;
  locked: boolean;
}) {
  const english = locale.toLowerCase().startsWith('en');
  const seatSelection = new Set(selection.flatMap((item) => item.kind === 'seat' ? [item.seatId] : []));
  const zoneQuantity = new Map(selection.flatMap((item) => item.kind === 'generalAdmission' ? [[item.zoneId, item.quantity] as const] : []));
  const amountFormatter = makeFormatter(locale, prices.currency);
  return (
    <details className="tp-accessible-picker">
      <summary>{english ? 'Choose tickets from a list' : 'Выбрать билеты списком'}</summary>
      {layout.snapshot.seats.length > 0 ? (
        <ul className="tp-accessible-picker__seats" aria-label={english ? 'Seats' : 'Места'}>
          {layout.snapshot.seats.map((seat) => {
            const status = availability.seats[seat.id] ?? 'unavailable';
            const available = status === 'available' || seatSelection.has(seat.id);
            const price = prices.seats[seat.id];
            return (
              <li key={seat.id}>
                <button
                  type="button"
                  aria-pressed={seatSelection.has(seat.id)}
                  disabled={locked || !available}
                  onClick={() => toggleSeat(seat.id)}
                >
                  {seat.label}{price ? ` · ${amountFormatter(price.amountMinor)}` : ''}
                  {!available ? ` · ${english ? status : 'недоступно'}` : ''}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {layout.snapshot.zones.some((zone) => zone.kind === 'ga') ? (
        <ul className="tp-accessible-picker__zones" aria-label={english ? 'Sections' : 'Секторы'}>
          {layout.snapshot.zones.filter((zone) => zone.kind === 'ga').map((zone) => {
            const stock = availability.zones?.[zone.id];
            const quantity = zoneQuantity.get(zone.id) ?? 0;
            const price = prices.zones[zone.id];
            const max = Math.min(stock?.available ?? 0, stock?.maxPerOrder ?? Number.MAX_SAFE_INTEGER);
            return (
              <li key={zone.id}>
                <label>
                  <span>{zone.name}{price ? ` · ${amountFormatter(price.amountMinor)}` : ''}</span>
                  <input
                    type="number"
                    min={0}
                    max={max}
                    step={1}
                    value={quantity}
                    disabled={locked || !stock || stock.available < 1}
                    aria-label={`${english ? 'Tickets in' : 'Билеты, сектор'} ${zone.name}`}
                    onChange={(event) => setGeneralAdmissionQuantity(zone.id, event.currentTarget.value)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </details>
  );
}

type ReadySelectionProps = {
  mapHeight: number;
  snapshot: PurchaseControllerSnapshot & {
    occurrence: NonNullable<PurchaseControllerSnapshot['occurrence']>;
    layout: NonNullable<PurchaseControllerSnapshot['layout']>;
    availability: NonNullable<PurchaseControllerSnapshot['availability']>;
    prices: NonNullable<PurchaseControllerSnapshot['prices']>;
  };
  onReserved?: (hold: BuyerHold) => void;
};

function InteractiveSelection(props: ReadySelectionProps) {
  const controller = useTicketPurchaseController().controller;
  return (
    <SeatSelectionProvider
      selection={props.snapshot.selection as readonly import('@hall-platform/seat-view').SeatSelectionItem[]}
      onSelectionChange={controller.setSelection}
    >
      <InteractiveSelectionBody {...props} />
    </SeatSelectionProvider>
  );
}

function InteractiveSelectionBody({
  mapHeight,
  onReserved,
  snapshot,
}: ReadySelectionProps) {
  const purchase = useTicketPurchase();
  const controller = purchase.controller;
  const [focusedFloorId, setFocusedFloorId] = useState('');
  const layout = snapshot.layout as PublishedHallLayout;
  const availability = snapshot.availability;
  const prices = snapshot.prices;
  const occurrence = snapshot.occurrence;
  const rendererAvailability = useMemo(() => mapBuyerAvailabilityToSeatView(availability), [availability]);
  const rendererPrices = useMemo(() => mapV2BuyerPricesToSeatView(prices), [prices]);
  const generalAdmissionZoneIds = useMemo(
    () => new Set<string>(layout.snapshot.zones.filter((zone) => zone.kind === 'ga').map((zone) => zone.id)),
    [layout.snapshot.zones],
  );
  const selectionState = useSeatSelection({
    layout,
    availability: rendererAvailability,
    prices: rendererPrices,
    locked: snapshot.status !== 'ready' || snapshot.hold?.status === 'active',
    contextKey: `${occurrence.occurrenceId}:${layout.snapshot.layoutVersionId}:${availability.revision}:${prices.pricingRevision}`,
    zoneIds: generalAdmissionZoneIds,
  });
  const floors = layout.snapshot.floors;
  const firstFloorId = floors[0]?.id ?? '';
  const activeFloorId = floors.some((floor) => floor.id === focusedFloorId) ? focusedFloorId : firstFloorId;
  const selectedCount = selectionState.validation.count;
  const selectedKeys = new Set(snapshot.selection.map((item) => item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`));
  const selectionIssue = SelectionIssueText({ code: selectionState.actionError, locale: purchase.locale });
  const currency = prices.currency;
  const requiresReleaseRetry = snapshot.errorCode === 'currency_mismatch' || snapshot.errorCode === 'hold_state_unknown';
  const hasSeatMap = occurrence.capabilities.seats && floors.length > 0 && layout.snapshot.seats.length > 0;
  const isEnglish = purchase.locale.toLowerCase().startsWith('en');
  const releaseRetryDescription = snapshot.errorCode === 'currency_mismatch'
    ? isEnglish
      ? 'The reservation cannot continue because its currency differs from the ticket prices. Retry releasing it before selecting tickets again.'
      : 'Резерв нельзя использовать: его валюта отличается от цен билетов. Повторите снятие резерва, чтобы выбрать билеты заново.'
    : isEnglish
      ? 'The reservation status could not be confirmed. Retry releasing it before continuing.'
      : 'Не удалось подтвердить статус резерва. Повторите его снятие, прежде чем продолжить.';
  const error = snapshot.error ?? selectionIssue;

  async function continueToContacts() {
    const result = await controller.continue();
    if (result.kind !== 'reserved') return;
    purchase.setStep('contacts');
    onReserved?.(result.hold);
  }

  async function confirmPrice() {
    const result = await Promise.resolve(controller.confirmServerTotal());
    if (result.kind !== 'reserved') return;
    purchase.setStep('contacts');
    onReserved?.(result.hold);
  }

  const hold = snapshot.hold;
  if (snapshot.status === 'reserved' && hold) {
    return (
      <section className="tp-reserved-state" aria-live="polite">
        <h3>{isEnglish ? 'Tickets reserved' : 'Билеты зарезервированы'}</h3>
        <p>{isEnglish ? 'Your selected tickets are held for checkout.' : 'Выбранные билеты ожидают оформления заказа.'}</p>
        <p className="tp-reserved-state__total">
          {isEnglish ? 'Order total' : 'Сумма заказа'}: <strong>{makeFormatter(purchase.locale, hold.currency)(hold.totalMinor)}</strong>
        </p>
      </section>
    );
  }

  const selectedSubtitle = selectedCount === 0
    ? (isEnglish ? 'Choose seats on the map or from the list.' : 'Выберите места на схеме или в списке.')
    : (isEnglish ? `${selectedCount} ticket${selectedCount === 1 ? '' : 's'} selected` : `Выбрано билетов: ${selectedCount}`);

  return (
    <>
      <section className="tp-ticket-selection">
        <div className="tp-ticket-selection__map-heading">
          <div>
            <h3>{isEnglish ? 'Hall map' : 'Схема зала'}</h3>
            <p>{selectedSubtitle}</p>
          </div>
        </div>
        {hasSeatMap ? (
          <div className="tp-seat-map-frame">
            <SeatMap
              layout={layout}
              availability={rendererAvailability}
              {...(snapshot.availabilityUpdatedSeatIds === null
                ? {}
                : { updatedSeatIds: snapshot.availabilityUpdatedSeatIds })}
              focusedFloorId={activeFloorId}
              locale={purchase.locale}
              height={mapHeight}
              onSeatClick={selectionState.toggleSeat}
              onZoneClick={(zoneId) => {
                if (!generalAdmissionZoneIds.has(zoneId)) return;
                const selectedZone = snapshot.selection.find((item) => item.kind === 'generalAdmission' && item.zoneId === zoneId);
                const currentQuantity = selectedZone?.kind === 'generalAdmission' ? selectedZone.quantity : 0;
                selectionState.setGeneralAdmissionQuantity(zoneId, currentQuantity + 1);
              }}
              onFloorChange={setFocusedFloorId}
            />
          </div>
        ) : null}
        {occurrence.capabilities.generalAdmission || occurrence.capabilities.seats ? (
          <AccessibleTicketPicker
            layout={layout}
            availability={rendererAvailability}
            prices={prices}
            locale={purchase.locale}
            selection={snapshot.selection}
            toggleSeat={selectionState.toggleSeat}
            setGeneralAdmissionQuantity={selectionState.setGeneralAdmissionQuantity}
            locked={snapshot.status !== 'ready' || snapshot.hold?.status === 'active'}
          />
        ) : null}
        {selectedKeys.size > 0 ? (
          <section className="tp-selected-section" aria-labelledby="tp-selected-title">
            <div className="tp-selected-section__heading">
              <div>
                <h3 id="tp-selected-title">{isEnglish ? 'Selected tickets' : 'Выбранные билеты'}</h3>
                <p>{selectedSubtitle}</p>
              </div>
            </div>
            <SelectedTicketsList
              layout={snapshot.layout}
              availability={rendererAvailability}
              prices={prices}
              selection={snapshot.selection}
              locale={purchase.locale}
          disabled={snapshot.status !== 'ready' || snapshot.hold?.status === 'active'}
              onRemove={(item) => selectionState.removeSelection(item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`)}
              onQuantityChange={selectionState.setGeneralAdmissionQuantity}
            />
          </section>
        ) : null}
        {selectionState.validation.issues.length > 0 && selectedCount > 0 ? (
          <p className="tp-selection-validation" role="alert">
            {SelectionIssueText({ code: selectionState.validation.issues[0]?.code ?? null, locale: purchase.locale })}
          </p>
        ) : null}
        <OrderSummary
          totalMinor={snapshot.totalMinor}
          currency={currency}
          locale={purchase.locale}
          selectedCount={selectedCount}
          disabled={(snapshot.status !== 'ready' && snapshot.status !== 'hold_retry_required') || !selectionState.validation.valid || snapshot.unavailableSelection.length > 0}
          loading={snapshot.status === 'submitting'}
          error={error}
          {...(snapshot.status === 'hold_retry_required' || snapshot.errorCode === 'network_error'
            ? { continueLabel: isEnglish ? 'Retry reservation' : 'Повторить резерв' }
            : {})}
          onContinue={() => void continueToContacts()}
        />
      </section>
      <PurchaseDialog
        open={snapshot.status === 'confirm_occurrence_change'}
        title={isEnglish ? 'Release tickets and change event time?' : 'Снять резерв и выбрать другое время?'}
        closeLabel={isEnglish ? 'Cancel event time change' : 'Отменить смену времени'}
        onClose={controller.cancelOccurrenceChange}
      >
        <p>{isEnglish
          ? 'The current reservation must be released before selecting another event time. Tickets will not transfer.'
          : 'Перед выбором другого сеанса нужно снять текущий резерв. Билеты на новый сеанс не переносятся.'}</p>
        {snapshot.error ? <p role="alert">{snapshot.error}</p> : null}
        <div className="tp-dialog-actions">
          <Button tone="quiet" onClick={controller.cancelOccurrenceChange}>{isEnglish ? 'Stay here' : 'Остаться на этом сеансе'}</Button>
          <Button tone="primary" onClick={() => void controller.confirmOccurrenceChange()}>{isEnglish ? 'Release and change' : 'Снять резерв и продолжить'}</Button>
        </div>
      </PurchaseDialog>
      <PurchaseDialog
        open={snapshot.status === 'price_confirmation_required'}
        title={requiresReleaseRetry
          ? snapshot.errorCode === 'currency_mismatch'
            ? isEnglish ? 'Reservation currency mismatch' : 'Валюта резерва не совпадает'
            : isEnglish ? 'Reservation status is unknown' : 'Статус резерва не подтверждён'
          : isEnglish ? 'Confirm the current ticket total' : 'Подтвердите актуальную сумму'}
        closeLabel={requiresReleaseRetry
          ? isEnglish ? 'Retry releasing reservation' : 'Повторить снятие резерва'
          : isEnglish ? 'Reject updated total' : 'Отказаться от новой суммы'}
        onClose={() => void controller.rejectServerTotal()}
      >
        <p>{requiresReleaseRetry
          ? releaseRetryDescription
          : isEnglish
            ? 'The server returned a different amount. Review and confirm it before moving to contact details.'
            : 'Сервер вернул другую сумму. Проверьте её и подтвердите перед переходом к контактным данным.'}</p>
        {requiresReleaseRetry ? null : <p className="tp-price-confirmation__total">
          {isEnglish ? 'Current total' : 'Новая сумма'}: <strong>{makeFormatter(purchase.locale, snapshot.serverCurrency ?? currency)(snapshot.serverTotalMinor)}</strong>
        </p>}
        {snapshot.error ? <p role="alert">{snapshot.error}</p> : null}
        <div className="tp-dialog-actions">
          <Button tone="quiet" onClick={() => void controller.rejectServerTotal()}>
            {requiresReleaseRetry
              ? isEnglish ? 'Retry release' : 'Повторить снятие'
              : isEnglish ? 'Choose different tickets' : 'Выбрать другие билеты'}
          </Button>
          <Button tone="primary" disabled={snapshot.serverTotalMinor === null || requiresReleaseRetry} onClick={() => void confirmPrice()}>
            {isEnglish ? 'Confirm total' : 'Подтвердить сумму'}
          </Button>
        </div>
      </PurchaseDialog>
    </>
  );
}

export function TicketSelectionStep({ eventId, occurrenceId, mapHeight = 360, onReserved }: TicketSelectionStepProps) {
  const purchase = useTicketPurchase();
  const setStep = purchase.setStep;
  const { controller, snapshot } = useTicketPurchaseController();
  const isEnglish = purchase.locale.toLowerCase().startsWith('en');
  const loading = snapshot.status === 'idle' || snapshot.status === 'loading';
  const headerContent: ReactNode = snapshot.occurrence ? (
    <OccurrenceSelector
      occurrences={snapshot.occurrences}
      selectedOccurrenceId={snapshot.occurrence.occurrenceId}
      timeZone={snapshot.occurrence.timeZone}
      locale={purchase.locale}
      disabled={snapshot.status !== 'ready' && snapshot.status !== 'reserved'}
      onChange={(id) => void controller.selectOccurrence(id)}
    />
  ) : null;

  useEffect(() => {
    setStep('selection');
    void controller.start(eventId, occurrenceId);
  }, [controller, eventId, occurrenceId, setStep]);

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      clearTimer();
      if (stopped || document.visibilityState === 'hidden') return;
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (stopped || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        await controller.syncAvailability();
        failures = 0;
        schedule(5_000);
      } catch {
        failures = Math.min(failures + 1, 4);
        schedule(Math.min(30_000, 5_000 * (2 ** failures)));
      } finally {
        inFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void poll();
      else clearTimer();
    };
    const refreshWhenOnline = () => void poll();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenOnline);
    schedule(5_000);
    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, [controller, snapshot.status]);

  useEffect(() => {
    if (snapshot.status === 'reserved') setStep('contacts');
  }, [setStep, snapshot.status]);

  let content: ReactNode;
  if (snapshot.status === 'not_found') {
    content = <ErrorState title={isEnglish ? 'Event time not found' : 'Сеанс не найден'} message={snapshot.error} locale={purchase.locale} retry={() => void controller.retry()} />;
  } else if (snapshot.status === 'sales_closed') {
    content = <ErrorState title={isEnglish ? 'Ticket sales are closed' : 'Продажа билетов закрыта'} message={snapshot.error ?? (isEnglish ? 'Tickets are not currently on sale.' : 'Билеты на этот сеанс сейчас не продаются.')} locale={purchase.locale} />;
  } else if (snapshot.status === 'sold_out') {
    content = <ErrorState title={isEnglish ? 'Sold out' : 'Билеты закончились'} message={isEnglish ? 'No tickets are available for this event time.' : 'На этот сеанс больше нет доступных билетов.'} locale={purchase.locale} />;
  } else if (snapshot.status === 'error') {
    content = <ErrorState title={isEnglish ? 'Could not load tickets' : 'Не удалось загрузить билеты'} message={snapshot.error} locale={purchase.locale} retry={() => void controller.retry()} />;
  } else if (!snapshot.layout || !snapshot.availability || !snapshot.prices) {
    content = <ErrorState title={isEnglish ? 'Ticket data is unavailable' : 'Данные о билетах недоступны'} message={snapshot.error} locale={purchase.locale} retry={() => void controller.retry()} />;
  } else {
    content = (
      <InteractiveSelection
        mapHeight={mapHeight}
        snapshot={snapshot as PurchaseControllerSnapshot & {
          occurrence: NonNullable<PurchaseControllerSnapshot['occurrence']>;
          layout: NonNullable<PurchaseControllerSnapshot['layout']>;
          availability: NonNullable<PurchaseControllerSnapshot['availability']>;
          prices: NonNullable<PurchaseControllerSnapshot['prices']>;
        }}
        {...(onReserved ? { onReserved } : {})}
      />
    );
  }

  return (
    <PurchaseLayout
      {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})}
      loading={loading}
      headerContent={headerContent}
    >
      {content}
    </PurchaseLayout>
  );
}

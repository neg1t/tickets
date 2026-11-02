import type { BuyerPrices, BuyerPublicLayout, BuyerSelection } from '@hall-platform/api-contracts';
import { SelectedTicketRow } from './SelectedTicketRow.js';
import type { SeatAvailabilityMap } from '@hall-platform/seat-view';

export type SelectedTicketsListProps = Readonly<{
  layout: BuyerPublicLayout;
  availability: SeatAvailabilityMap;
  prices: BuyerPrices;
  selection: readonly BuyerSelection[];
  locale: string;
  disabled?: boolean;
  onRemove: (item: BuyerSelection) => void;
  onQuantityChange: (zoneId: string, quantity: number) => void;
}>;

function currencyFormatter(locale: string, currency: string) {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return (minor: number | null) => minor !== null && Number.isSafeInteger(minor)
    ? formatter.format(minor / (10 ** digits))
    : '—';
}

type SelectedTicketDisplayRow = {
  item: BuyerSelection;
  title: string;
  quantity: number;
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  maxQuantity?: number;
};

export function SelectedTicketsList({
  layout,
  availability,
  prices,
  selection,
  locale,
  disabled = false,
  onRemove,
  onQuantityChange,
}: SelectedTicketsListProps) {
  const formatMoney = currencyFormatter(locale, prices.currency);
  const seats = Object.fromEntries(layout.snapshot.seats.map((seat) => [seat.id, seat]));
  const zones = Object.fromEntries(layout.snapshot.zones.map((zone) => [zone.id, zone]));
  const rows: SelectedTicketDisplayRow[] = [];
  for (const item of selection) {
    if (item.kind === 'seat') {
      const seat = seats[item.seatId];
      const price = prices.seats[item.seatId];
      const label = seat?.label ?? `${locale.toLowerCase().startsWith('en') ? 'Seat' : 'Место'} ${item.seatId}`;
      rows.push({
        item,
        title: label,
        quantity: 1,
        unitPriceMinor: price?.amountMinor ?? null,
        lineTotalMinor: price?.amountMinor ?? null,
      });
      continue;
    }
    const zone = zones[item.zoneId];
    const price = prices.zones[item.zoneId];
    const lineTotalMinor = price ? price.amountMinor * item.quantity : null;
    const maxQuantity = availability.zones?.[item.zoneId]?.maxPerOrder;
    rows.push({
      item,
      title: zone?.name ?? `${locale.toLowerCase().startsWith('en') ? 'Section' : 'Сектор'} ${item.zoneId}`,
      quantity: item.quantity,
      unitPriceMinor: price?.amountMinor ?? null,
      lineTotalMinor: lineTotalMinor !== null && Number.isSafeInteger(lineTotalMinor) ? lineTotalMinor : null,
      ...(maxQuantity === undefined ? {} : { maxQuantity }),
    });
  }

  if (rows.length === 0) {
    return (
      <p className="tp-selected-tickets__empty">
        {locale.toLowerCase().startsWith('en') ? 'No tickets selected yet.' : 'Вы пока не выбрали билеты.'}
      </p>
    );
  }

  return (
    <ul className="tp-selected-tickets" aria-label={locale.toLowerCase().startsWith('en') ? 'Selected tickets' : 'Выбранные билеты'}>
      {rows.map(({ item, title, quantity, unitPriceMinor, lineTotalMinor, maxQuantity }) => (
        <SelectedTicketRow
          key={item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`}
          item={item}
          title={title}
          quantity={quantity}
          unitPrice={formatMoney(unitPriceMinor)}
          lineTotal={formatMoney(lineTotalMinor)}
          {...(maxQuantity ? { maxQuantity } : {})}
          disabled={disabled}
          locale={locale}
          {...(item.kind === 'generalAdmission' ? { onQuantityChange: (next) => onQuantityChange(item.zoneId, next) } : {})}
          onRemove={() => onRemove(item)}
        />
      ))}
    </ul>
  );
}

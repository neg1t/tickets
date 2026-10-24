import type { SeatStatus } from '@hall-platform/domain';

export type PlaceDetails = Readonly<{
  hall: string;
  floor: string;
  zone: string;
  row: string;
  seat: string;
  status: SeatStatus;
  price: string;
  category?: string;
}>;

export function SeatDetails({
  details,
  title,
  seatLabel,
  rowLabel,
  statusLabel,
  priceLabel,
  statuses,
  tooltip = false,
}: Readonly<{
  details: PlaceDetails;
  title: string;
  seatLabel: string;
  rowLabel: string;
  statusLabel: string;
  priceLabel: string;
  statuses: Readonly<Record<SeatStatus, string>>;
  tooltip?: boolean;
}>) {
  return (
    <section
      className={`seat-view-details${tooltip ? ' seat-view-tooltip' : ''}`}
      aria-label={title}
      role={tooltip ? 'tooltip' : 'region'}
    >
      <small className="seat-view-overline">{title}</small>
      <strong>
        {seatLabel} {details.seat}
      </strong>
      <p>
        {details.hall} · {details.floor} · {details.zone} · {rowLabel}{' '}
        {details.row}
      </p>
      <dl>
        <div>
          <dt>{statusLabel}</dt>
          <dd>{statuses[details.status]}</dd>
        </div>
        <div>
          <dt>{priceLabel}</dt>
          <dd>{details.price}</dd>
        </div>
      </dl>
      {details.category && <small>{details.category}</small>}
    </section>
  );
}

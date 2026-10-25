import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export type AccessibleSeatListItem = Readonly<{
  id: string;
  label: string;
  address: string;
  status: string;
  price: string;
  category?: string;
  selected: boolean;
  disabled: boolean;
}>;

const windowSize = 80;

export function AccessibleSeatList({
  label,
  seatLabel,
  emptyLabel,
  previousLabel,
  nextLabel,
  rangeLabel,
  seats,
  getItem,
  isEnabled,
  onSelect,
  onInspect,
}: Readonly<{
  label: string;
  seatLabel: string;
  emptyLabel: string;
  previousLabel: string;
  nextLabel: string;
  rangeLabel: (first: number, last: number, total: number) => string;
  seats: readonly Readonly<{ id: string }>[];
  getItem: (id: string) => AccessibleSeatListItem;
  isEnabled: (id: string) => boolean;
  onSelect: (id: string) => void;
  onInspect: (id: string | null) => void;
}>) {
  const [windowStart, setWindowStart] = useState(0);
  const pendingFocusId = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const lastWindowStart = Math.max(
    0,
    Math.floor((seats.length - 1) / windowSize) * windowSize,
  );
  const start = Math.min(windowStart, lastWindowStart);
  const end = Math.min(start + windowSize, seats.length);
  const visibleSeats = seats.slice(start, end).map((seat) => getItem(seat.id));

  useLayoutEffect(() => {
    const id = pendingFocusId.current;
    if (id) {
      buttons.current.get(id)?.focus();
      pendingFocusId.current = null;
    }
  }, [start]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction =
      event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    let target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? seats.length - 1
          : index + direction;
    const step = event.key === 'Home' ? 1 : event.key === 'End' ? -1 : direction;
    while (target >= 0 && target < seats.length) {
      const id = seats[target]?.id;
      if (id && isEnabled(id)) {
        event.preventDefault();
        if (target < start || target >= end) {
          pendingFocusId.current = id;
          setWindowStart(Math.floor(target / windowSize) * windowSize);
        } else {
          buttons.current.get(id)?.focus();
        }
        return;
      }
      target += step;
    }
  }

  return (
    <>
      <div className="seat-view-seat-list" aria-label={label}>
        {seats.length === 0 && <p>{emptyLabel}</p>}
        {visibleSeats.map((seat, index) => (
          <button
            key={seat.id}
            ref={(node) => {
              if (node) buttons.current.set(seat.id, node);
              else buttons.current.delete(seat.id);
            }}
            type="button"
            aria-label={`${seatLabel} ${seat.label} — ${seat.status} · ${seat.address} · ${seat.price}`}
            aria-pressed={seat.selected}
            disabled={seat.disabled}
            title={`${seat.address} · ${seat.price}`}
            onClick={() => onSelect(seat.id)}
            onMouseEnter={() => onInspect(seat.id)}
            onMouseLeave={() => onInspect(null)}
            onFocus={() => onInspect(seat.id)}
            onBlur={() => onInspect(null)}
            onKeyDown={(event) => moveFocus(event, start + index)}
          >
            <strong>{seat.label}</strong>
            <small className="seat-view-seat-address">{seat.address}</small>
            <span>{seat.status}</span>
            <span>{seat.price}</span>
            {seat.category && <small>{seat.category}</small>}
          </button>
        ))}
      </div>
      {seats.length > windowSize && (
        <div className="seat-view-seat-list-controls">
          <button
            type="button"
            disabled={start === 0}
            onClick={() => setWindowStart(Math.max(0, start - windowSize))}
          >
            {previousLabel}
          </button>
          <span role="status" aria-live="polite">
            {rangeLabel(start + 1, end, seats.length)}
          </span>
          <button
            type="button"
            disabled={end === seats.length}
            onClick={() => setWindowStart(Math.min(lastWindowStart, start + windowSize))}
          >
            {nextLabel}
          </button>
        </div>
      )}
    </>
  );
}

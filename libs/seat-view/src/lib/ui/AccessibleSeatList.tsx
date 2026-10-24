import type { KeyboardEvent } from 'react';

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

export function AccessibleSeatList({
  label,
  seatLabel,
  emptyLabel,
  seats,
  onSelect,
  onInspect,
}: Readonly<{
  label: string;
  seatLabel: string;
  emptyLabel: string;
  seats: readonly AccessibleSeatListItem[];
  onSelect: (id: string) => void;
  onInspect: (id: string | null) => void;
}>) {
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    const target =
      event.key === 'ArrowDown'
        ? buttons[index + 1]
        : event.key === 'ArrowUp'
          ? buttons[index - 1]
          : event.key === 'Home'
            ? buttons[0]
            : event.key === 'End'
              ? buttons.at(-1)
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  return (
    <div className="seat-view-seat-list" aria-label={label}>
      {seats.length === 0 && <p>{emptyLabel}</p>}
      {seats.map((seat) => (
        <button
          key={seat.id}
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
          onKeyDown={moveFocus}
        >
          <strong>{seat.label}</strong>
          <small className="seat-view-seat-address">{seat.address}</small>
          <span>{seat.status}</span>
          <span>{seat.price}</span>
          {seat.category && <small>{seat.category}</small>}
        </button>
      ))}
    </div>
  );
}

import { useState, type ReactNode } from 'react';

export function SelectionBasket({
  selectedLabel,
  totalLabel,
  missingPriceLabel,
  buyLabel,
  buyingLabel,
  removeLabel,
  count,
  total,
  items,
  disabled,
  buyDisabled,
  buying,
  issue,
  onRemove,
  onBuy,
}: Readonly<{
  selectedLabel: string;
  totalLabel: string;
  missingPriceLabel: string;
  buyLabel: string;
  buyingLabel: string;
  removeLabel: string;
  count: number;
  total: string | null;
  items: readonly Readonly<{
    key: string;
    name: string;
    price: string | null;
  }>[];
  disabled: boolean;
  buyDisabled: boolean;
  buying: boolean;
  issue: ReactNode;
  onRemove: (key: string) => void;
  onBuy: () => void;
}>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="seat-view-basket" data-expanded={expanded}>
      <div className="seat-view-basket-summary" aria-live="polite">
        <strong>
          {selectedLabel}: {count}
        </strong>
        {count > 0 && (
          <span>
            {totalLabel}: {total ?? missingPriceLabel}
          </span>
        )}
        {count > 0 && (
          <button
            type="button"
            className="seat-view-basket-toggle"
            aria-label={selectedLabel}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '⌄' : '⌃'}
          </button>
        )}
      </div>
      <div className="seat-view-basket-items">
        {items.map((item) => (
          <div className="seat-view-basket-item" key={item.key}>
            <span>
              {item.name}
              {item.price && <small> · {item.price}</small>}
            </span>
            <button
              type="button"
              aria-label={`${removeLabel} ${item.name}`}
              disabled={disabled}
              onClick={() => onRemove(item.key)}
            >
              {removeLabel}
            </button>
          </div>
        ))}
      </div>
      {issue}
      <button
        type="button"
        className="seat-view-buy"
        disabled={disabled || buyDisabled || count === 0 || !total}
        onClick={onBuy}
      >
        {buying ? buyingLabel : buyLabel}
      </button>
    </div>
  );
}

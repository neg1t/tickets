import type { BuyerSelection } from '@hall-platform/api-contracts';
import { Button } from '@hall-platform/ui';

export type SelectedTicketRowProps = Readonly<{
  item: BuyerSelection;
  title: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  maxQuantity?: number;
  disabled?: boolean;
  locale: string;
  onQuantityChange?: (quantity: number) => void;
  onRemove: () => void;
}>;

export function SelectedTicketRow({
  item,
  title,
  quantity,
  unitPrice,
  lineTotal,
  maxQuantity,
  disabled = false,
  locale,
  onQuantityChange,
  onRemove,
}: SelectedTicketRowProps) {
  const isGeneralAdmission = item.kind === 'generalAdmission';
  const quantityLabel = locale.toLowerCase().startsWith('en') ? 'Quantity' : 'Количество';
  const unitLabel = locale.toLowerCase().startsWith('en') ? 'each' : 'за билет';

  return (
    <li className="tp-selected-ticket" data-selection-key={item.kind === 'seat' ? `seat:${item.seatId}` : `zone:${item.zoneId}`}>
      <div className="tp-selected-ticket__description">
        <strong>{title}</strong>
        {isGeneralAdmission ? (
          <span>{quantity} × {unitPrice} {unitLabel}</span>
        ) : (
          <span>{unitPrice}</span>
        )}
      </div>
      {isGeneralAdmission && onQuantityChange ? (
        <label className="tp-selected-ticket__quantity">
          <span className="tp-sr-only">{quantityLabel}: {title}</span>
          <input
            aria-label={`${quantityLabel}: ${title}`}
            type="number"
            min={1}
            {...(maxQuantity ? { max: maxQuantity } : {})}
            value={quantity}
            disabled={disabled}
            onChange={(event) => onQuantityChange(Number(event.currentTarget.value))}
          />
        </label>
      ) : null}
      <strong className="tp-selected-ticket__total">{lineTotal}</strong>
      <Button
        className="tp-selected-ticket__remove"
        tone="quiet"
        size="sm"
        aria-label={locale.toLowerCase().startsWith('en') ? `Remove ${title}` : `Удалить ${title}`}
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </Button>
    </li>
  );
}

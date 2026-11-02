import { Button } from '@hall-platform/ui';
import type { BuyerQuote } from '@hall-platform/api-contracts';
import { formatMinorAmount } from '../model/money.js';

export type OrderSummaryProps = Readonly<{
  totalMinor: number | null;
  currency: string;
  locale: string;
  selectedCount: number;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  continueLabel?: string;
  loadingLabel?: string;
  quote?: BuyerQuote | null;
  onContinue: () => void;
}>;

export function OrderSummary({
  totalMinor,
  currency,
  locale,
  selectedCount,
  disabled = false,
  loading = false,
  error = null,
  continueLabel,
  loadingLabel,
  quote = null,
  onContinue,
}: OrderSummaryProps) {
  const english = locale.toLowerCase().startsWith('en');
  const total = totalMinor === null
    ? '—'
    : formatMinorAmount(locale, currency, totalMinor);
  return (
    <section className="tp-order-summary" aria-label={english ? 'Order summary' : 'Итог заказа'}>
      {quote ? (
        <>
          <ul className="tp-order-summary__items">
            {quote.lines.map((line, index) => (
              <li key={`${line.label}:${index}`}>
                <span>{line.label} · {line.quantity} × {formatMinorAmount(locale, quote.currency, line.unitPriceMinor)}</span>
                <strong>{formatMinorAmount(locale, quote.currency, line.totalMinor)}</strong>
              </li>
            ))}
          </ul>
          <div className="tp-order-summary__breakdown">
            <div className="tp-order-summary__line">
              <span>{english ? 'Tickets' : 'Стоимость билетов'}</span>
              <strong>{formatMinorAmount(locale, quote.currency, quote.ticketsSubtotalMinor)}</strong>
            </div>
            {quote.discountMinor > 0 ? (
              <div className="tp-order-summary__line">
                <span>{english ? 'Discount' : 'Скидка'}</span>
                <strong>−{formatMinorAmount(locale, quote.currency, quote.discountMinor)}</strong>
              </div>
            ) : null}
            {quote.serviceFeeMinor > 0 ? (
              <div className="tp-order-summary__line">
                <span>{english ? 'Service fee' : 'Сервисный сбор'}</span>
                <strong>{formatMinorAmount(locale, quote.currency, quote.serviceFeeMinor)}</strong>
              </div>
            ) : null}
            {quote.commissionMinor > 0 ? (
              <div className="tp-order-summary__line">
                <span>{english ? 'Commission' : 'Комиссия'}</span>
                <strong>{formatMinorAmount(locale, quote.currency, quote.commissionMinor)}</strong>
              </div>
            ) : null}
            <div className="tp-order-summary__line tp-order-summary__line--total">
              <span>{english ? 'Total' : 'Итого'}</span>
              <strong>{formatMinorAmount(locale, quote.currency, quote.totalMinor)}</strong>
            </div>
          </div>
        </>
      ) : (
        <div className="tp-order-summary__line">
          <span>{english ? `Tickets (${selectedCount})` : `Билеты (${selectedCount})`}</span>
          <strong>{total}</strong>
        </div>
      )}
      {error ? <p className="tp-order-summary__error" role="alert">{error}</p> : null}
      <Button
        className="tp-order-summary__continue"
        tone="primary"
        disabled={disabled || loading || selectedCount === 0}
        onClick={onContinue}
      >
        {loading ? loadingLabel ?? (english ? 'Working…' : 'Обрабатываем…') : continueLabel ?? (english ? 'Continue' : 'Продолжить')}
      </Button>
    </section>
  );
}

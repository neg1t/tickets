import type { PricingMoney } from './pricingCatalog.js';

const fractionDigitsByCurrency = new Map<string, number>();

export function pricingCurrencyFractionDigits(currency: string): number {
  const cached = fractionDigitsByCurrency.get(currency);
  if (cached !== undefined) return cached;
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  fractionDigitsByCurrency.set(currency, digits);
  return digits;
}

export function pricingMoneyToMajor(money: PricingMoney): number {
  return money.amountMinor / 10 ** pricingCurrencyFractionDigits(money.currency);
}

export function formatPricingMoney(money: PricingMoney, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(pricingMoneyToMajor(money));
}

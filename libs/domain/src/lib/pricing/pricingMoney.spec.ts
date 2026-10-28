import { describe, expect, it } from 'vitest';
import { formatPricingMoney, pricingMoneyToMajor } from './pricingMoney.js';

describe('pricing money conversion', () => {
  it('uses ISO currency fraction digits for minor-unit conversion', () => {
    expect(pricingMoneyToMajor({ amountMinor: 1250, currency: 'RUB' })).toBe(12.5);
    expect(pricingMoneyToMajor({ amountMinor: 1250, currency: 'JPY' })).toBe(1250);
    expect(pricingMoneyToMajor({ amountMinor: 1250, currency: 'KWD' })).toBe(1.25);
  });

  it('formats money through locale-aware currency formatting', () => {
    expect(formatPricingMoney({ amountMinor: 125000, currency: 'RUB' }, 'ru-RU'))
      .toContain('1 250');
    expect(formatPricingMoney({ amountMinor: 125000, currency: 'USD' }, 'en-US'))
      .toContain('$1,250.00');
  });
});

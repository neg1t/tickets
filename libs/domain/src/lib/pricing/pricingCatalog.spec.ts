import { describe, expect, it } from 'vitest';
import {
  getPricingCatalogDiagnostics,
  pricingCatalogSchema,
} from './pricingCatalog.js';

const segment = {
  id: 'segment-standard',
  name: 'Standard',
  color: '#336699',
  status: 'active',
  price: { amountMinor: 1000, currency: 'RUB' },
};

describe('pricing catalog', () => {
  it('accepts an explicit free segment and keeps IDs distinct from names/colors', () => {
    const result = pricingCatalogSchema.parse({
      occurrenceId: 'occ-1',
      revision: 2,
      items: [
        { ...segment, price: { amountMinor: 0, currency: 'RUB' } },
        { ...segment, id: 'segment-vip', name: 'VIP', color: segment.color },
      ],
    });

    expect(result.items.map(({ id }) => id)).toEqual([
      'segment-standard',
      'segment-vip',
    ]);
    expect(result.items[0]?.price.amountMinor).toBe(0);
  });

  it('rejects duplicate IDs and malformed colors or money', () => {
    expect(
      pricingCatalogSchema.safeParse({
        occurrenceId: 'occ-1',
        revision: 0,
        items: [segment, segment],
      }).success,
    ).toBe(false);
    expect(
      pricingCatalogSchema.safeParse({
        occurrenceId: 'occ-1',
        revision: 0,
        items: [{ ...segment, color: 'red' }],
      }).success,
    ).toBe(false);
    expect(
      pricingCatalogSchema.safeParse({
        occurrenceId: 'occ-1',
        revision: 0,
        items: [{ ...segment, price: { amountMinor: 1.5, currency: 'RUB' } }],
      }).success,
    ).toBe(false);
  });

  it('reports mixed currencies as a blocking catalog diagnostic', () => {
    const catalog = pricingCatalogSchema.parse({
      occurrenceId: 'occ-1',
      revision: 0,
      items: [
        segment,
        {
          ...segment,
          id: 'segment-usd',
          name: 'USD',
          price: { amountMinor: 250, currency: 'USD' },
        },
      ],
    });

    expect(getPricingCatalogDiagnostics(catalog)).toEqual([
      expect.objectContaining({ code: 'mixed_catalog_currency' }),
    ]);
  });
});

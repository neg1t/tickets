import { z } from 'zod';

const currencyCodes = new Set(Intl.supportedValuesOf('currency'));

export const pricingMoneySchema = z.strictObject({
  amountMinor: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((code) => currencyCodes.has(code))
    .describe('ISO 4217 currency code'),
});

export type PricingMoney = z.infer<typeof pricingMoneySchema>;

export const pricingSegmentSchema = z.strictObject({
  id: z.string().min(1).refine((value) => value.trim().length > 0),
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[\da-fA-F]{6}$/),
  status: z.enum(['active', 'archived']),
  price: pricingMoneySchema,
});

export type PricingSegment = z.infer<typeof pricingSegmentSchema>;

export const pricingCatalogSchema = z
  .strictObject({
    occurrenceId: z.string().min(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    items: z.array(pricingSegmentSchema),
  })
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    catalog.items.forEach((segment, index) => {
      if (ids.has(segment.id)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `Duplicate pricing segment ID: ${segment.id}`,
        });
      }
      ids.add(segment.id);
    });
  });

export type PricingCatalog = z.infer<typeof pricingCatalogSchema>;

export type PricingCatalogDiagnostic = Readonly<{
  code: 'mixed_catalog_currency';
  message: string;
}>;

export function getPricingCatalogDiagnostics(
  catalog: PricingCatalog,
): PricingCatalogDiagnostic[] {
  const currencies = new Set(
    catalog.items.map((segment) => segment.price.currency),
  );
  if (currencies.size <= 1) return [];

  return [
    {
      code: 'mixed_catalog_currency',
      message: 'All pricing segments for an occurrence must use one currency.',
    },
  ];
}

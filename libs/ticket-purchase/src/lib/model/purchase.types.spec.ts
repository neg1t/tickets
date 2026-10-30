import { describe, expect, it } from 'vitest';
import {
  PurchaseConfigurationError,
  requirePurchaseDataSource,
  type PurchaseDataSource,
} from './purchase.types.js';

describe('requirePurchaseDataSource', () => {
  it('returns the configured source unchanged', () => {
    const source = {} as PurchaseDataSource;

    expect(requirePurchaseDataSource(source)).toBe(source);
  });

  it('throws a configuration error when no source was provided', () => {
    expect(() => requirePurchaseDataSource(undefined)).toThrow(PurchaseConfigurationError);
  });
});

/** Format a server-provided integer amount in the currency's minor units. */
export function formatMinorAmount(locale: string, currency: string, amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError('Money amount must be a non-negative safe integer in minor units');
  }

  let digits: number;
  try {
    digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new RangeError(`Unsupported currency: ${currency}`);
  }

  const amount = amountMinor / (10 ** digits);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  }
}

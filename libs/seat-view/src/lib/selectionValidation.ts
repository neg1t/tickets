import type {
  PublishedHallLayout,
  SeatAvailabilityMap,
  SeatPrice,
  SeatPriceMap,
  SeatSelectionItem,
} from './SeatView.js';

export type SelectionValidationIssueCode =
  | 'empty_selection'
  | 'invalid_item'
  | 'invalid_id'
  | 'unknown_seat'
  | 'unknown_zone'
  | 'unavailable_seat'
  | 'unavailable_zone'
  | 'invalid_quantity'
  | 'quantity_exceeds_availability'
  | 'quantity_exceeds_limit'
  | 'duplicate_item'
  | 'missing_price'
  | 'invalid_price'
  | 'mixed_currencies'
  | 'total_overflow';

export type SelectionValidationIssue = {
  readonly code: SelectionValidationIssueCode;
  readonly kind?: 'seat' | 'generalAdmission';
  readonly id?: string;
};

export type SelectionTotal = {
  /** Major currency units, matching SeatPrice.amount. */
  readonly amount: number;
  readonly currency: string;
  readonly minorUnits: number;
};

export type SelectionValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly SelectionValidationIssue[];
  readonly count: number;
  readonly total: SelectionTotal | null;
};

export type SeatPriceValidationResult =
  | {
      readonly valid: true;
      readonly currency: string;
      readonly fractionDigits: number;
      readonly minorUnits: number;
    }
  | { readonly valid: false; readonly code: 'missing_price' | 'invalid_price' };

const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));
const largestSafeMinorUnit = BigInt(Number.MAX_SAFE_INTEGER);
const currencyFractionDigits = new Map<string, number | null>();

function getCurrencyFractionDigits(currency: string): number | null {
  if (currencyFractionDigits.has(currency))
    return currencyFractionDigits.get(currency) ?? null;
  let fractionDigits: number | null = null;
  try {
    const value = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    if (value !== undefined) fractionDigits = value;
  } catch {
    /* Invalid currency metadata remains cached as a rejected result. */
  }
  currencyFractionDigits.set(currency, fractionDigits);
  return fractionDigits;
}

/** SeatPrice.amount is in major units; returns an exact, safe integer minor amount. */
export function validateSeatPrice(
  price: SeatPrice | undefined,
): SeatPriceValidationResult {
  if (price === undefined) return { valid: false, code: 'missing_price' };
  if (price === null || typeof price !== 'object')
    return { valid: false, code: 'invalid_price' };
  const { amount, currency } = price;
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof currency !== 'string' ||
    !/^[A-Z]{3}$/.test(currency) ||
    !supportedCurrencies.has(currency)
  )
    return { valid: false, code: 'invalid_price' };

  const fractionDigits = getCurrencyFractionDigits(currency);
  if (fractionDigits === null) return { valid: false, code: 'invalid_price' };
  const parts = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(amount.toString());
  if (!parts) return { valid: false, code: 'invalid_price' };
  const digits = `${parts[1]}${parts[2] ?? ''}`;
  const shift =
    Number(parts[3] ?? 0) + fractionDigits - (parts[2]?.length ?? 0);
  const minorText =
    shift >= 0 ? `${digits}${'0'.repeat(shift)}` : digits.slice(0, shift);
  if (shift < 0 && !/^0*$/.test(digits.slice(shift))) {
    return { valid: false, code: 'invalid_price' };
  }
  const minor = BigInt(minorText || '0');
  if (minor > largestSafeMinorUnit)
    return { valid: false, code: 'invalid_price' };
  return { valid: true, currency, fractionDigits, minorUnits: Number(minor) };
}

export function validateSelection(input: {
  readonly layout: PublishedHallLayout;
  readonly selection: readonly SeatSelectionItem[];
  readonly availability: SeatAvailabilityMap;
  readonly prices: SeatPriceMap;
  readonly seatIds?: Pick<ReadonlySet<string>, 'has'>;
  readonly zoneIds?: Pick<ReadonlySet<string>, 'has'>;
}): SelectionValidationResult {
  const { layout, selection, availability, prices } = input;
  const issues: SelectionValidationIssue[] = [];
  if (selection.length === 0) issues.push({ code: 'empty_selection' });
  const seatIds =
    input.seatIds ??
    new Set<string>(layout.snapshot.seats.map((seat) => seat.id));
  const zoneIds =
    input.zoneIds ??
    new Set<string>(layout.snapshot.zones.map((zone) => zone.id));
  const seen = new Set<string>();
  let count = 0;
  let minorTotal = 0n;
  let currency: string | undefined;
  let fractionDigits = 0;

  for (const item of selection) {
    if (!item || (item.kind !== 'seat' && item.kind !== 'generalAdmission')) {
      issues.push({ code: 'invalid_item' });
      continue;
    }
    const kind = item.kind;
    const id = kind === 'seat' ? item.seatId : item.zoneId;
    if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
      issues.push({ code: 'invalid_id', kind });
      continue;
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) issues.push({ code: 'duplicate_item', kind, id });
    seen.add(key);

    if (kind === 'seat') {
      count += 1;
      if (!seatIds.has(id)) issues.push({ code: 'unknown_seat', kind, id });
      else if (availability.seats[id] !== 'available') {
        issues.push({ code: 'unavailable_seat', kind, id });
      }
    } else {
      if (Number.isSafeInteger(item.quantity) && item.quantity > 0) {
        count += item.quantity;
      } else {
        issues.push({ code: 'invalid_quantity', kind, id });
      }
      if (!zoneIds.has(id)) issues.push({ code: 'unknown_zone', kind, id });
      else {
        const stock = availability.zones?.[id];
        if (
          !stock ||
          !Number.isSafeInteger(stock.available) ||
          stock.available <= 0 ||
          (stock.maxPerOrder !== undefined &&
            (!Number.isSafeInteger(stock.maxPerOrder) ||
              stock.maxPerOrder <= 0))
        ) {
          issues.push({ code: 'unavailable_zone', kind, id });
        } else if (Number.isSafeInteger(item.quantity) && item.quantity > 0) {
          if (item.quantity > stock.available) {
            issues.push({ code: 'quantity_exceeds_availability', kind, id });
          } else if (
            stock.maxPerOrder !== undefined &&
            item.quantity > stock.maxPerOrder
          ) {
            issues.push({ code: 'quantity_exceeds_limit', kind, id });
          }
        }
      }
    }

    const price = kind === 'seat' ? prices.seats[id] : prices.zones?.[id];
    const checkedPrice = validateSeatPrice(price);
    if (!checkedPrice.valid) {
      issues.push({ code: checkedPrice.code, kind, id });
      continue;
    }
    if (currency !== undefined && checkedPrice.currency !== currency) {
      issues.push({ code: 'mixed_currencies', kind, id });
    } else {
      currency = checkedPrice.currency;
      fractionDigits = checkedPrice.fractionDigits;
    }
    if (
      kind === 'seat' ||
      (Number.isSafeInteger(item.quantity) && item.quantity > 0)
    ) {
      minorTotal +=
        BigInt(checkedPrice.minorUnits) *
        BigInt(kind === 'seat' ? 1 : item.quantity);
    }
  }

  if (!Number.isSafeInteger(count) || minorTotal > largestSafeMinorUnit) {
    issues.push({ code: 'total_overflow' });
  }
  if (issues.length > 0 || currency === undefined) {
    return {
      valid: false,
      issues,
      count: Number.isSafeInteger(count) ? count : 0,
      total: null,
    };
  }
  const minorUnits = Number(minorTotal);
  return {
    valid: true,
    issues: [],
    count,
    total: { amount: minorUnits / 10 ** fractionDigits, currency, minorUnits },
  };
}

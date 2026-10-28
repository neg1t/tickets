import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  validateSeatPrice,
  type SelectionValidationIssueCode,
} from './selectionValidation.js';
import type {
  SeatAvailabilityMap,
  SeatPriceMap,
  SeatSelectionItem,
  SeatViewData,
} from './SeatView.js';

type SelectionMessages = Readonly<{
  seatUnavailable: string;
  missingPrice: string;
  invalidQuantity: string;
}>;

type UseSeatSelectionOptions = Readonly<{
  contextKey: string;
  occurrenceId: string;
  selection: readonly SeatSelectionItem[];
  availability: SeatAvailabilityMap;
  prices: SeatPriceMap;
  locked: boolean;
  messages: SelectionMessages;
  onSelectionChange: (selection: SeatSelectionItem[]) => void;
  onBuyClick: (data: SeatViewData) => void | Promise<void>;
  onError?: (error: Error) => void;
}>;

function isSelectionItem(item: SeatSelectionItem): boolean {
  return Boolean(
    item &&
      (item.kind === 'seat'
        ? typeof item.seatId === 'string'
        : item.kind === 'generalAdmission' &&
          typeof item.zoneId === 'string' &&
          typeof item.quantity === 'number'),
  );
}

export function useSeatSelection({
  contextKey,
  occurrenceId,
  selection,
  availability,
  prices,
  locked,
  messages,
  onSelectionChange,
  onBuyClick,
  onError,
}: UseSeatSelectionOptions) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestContext = useRef(contextKey);
  const previousContext = useRef(contextKey);
  useEffect(() => {
    latestContext.current = contextKey;
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setError(null);
    setPending(false);
  }, [contextKey]);

  const safeSelection = useMemo(
    () => selection.filter(isSelectionItem),
    [selection],
  );
  const selectedSeatIds = useMemo(
    () =>
      new Set(
        safeSelection.flatMap((item) =>
          item.kind === 'seat' ? [item.seatId] : [],
        ),
      ),
    [safeSelection],
  );

  const handleSeatClick = useCallback(
    (seatId: string) => {
      if (locked || pending) return;
      if (selectedSeatIds.has(seatId)) {
        onSelectionChange(
          safeSelection.filter(
            (item) => item.kind !== 'seat' || item.seatId !== seatId,
          ),
        );
        return;
      }
      if (availability.seats[seatId] !== 'available') {
        setError(messages.seatUnavailable);
        return;
      }
      if (!validateSeatPrice(prices.seats[seatId]).valid) {
        setError(messages.missingPrice);
        return;
      }
      setError(null);
      onSelectionChange([...safeSelection, { kind: 'seat', seatId }]);
    },
    [
      availability.seats,
      locked,
      messages.missingPrice,
      messages.seatUnavailable,
      onSelectionChange,
      pending,
      prices.seats,
      safeSelection,
      selectedSeatIds,
    ],
  );

  const handleQuantityChange = useCallback(
    (zoneId: string, rawValue: string) => {
      if (locked || pending) return;
      const zone = availability.zones?.[zoneId];
      if (!zone) return;
      const limit = Math.min(zone.available, zone.maxPerOrder ?? zone.available);
      const quantity = Number(rawValue);
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > limit) {
        setError(messages.invalidQuantity);
        return;
      }
      setError(null);
      onSelectionChange([
        ...safeSelection.filter(
          (item) => item.kind !== 'generalAdmission' || item.zoneId !== zoneId,
        ),
        ...(quantity > 0
          ? [{ kind: 'generalAdmission' as const, zoneId, quantity }]
          : []),
      ]);
    },
    [
      availability.zones,
      locked,
      messages.invalidQuantity,
      onSelectionChange,
      pending,
      safeSelection,
    ],
  );

  const removeSelection = useCallback(
    (key: string) => {
      onSelectionChange(
        safeSelection.filter(
          (item) =>
            key !==
            (item.kind === 'seat'
              ? `seat:${item.seatId}`
              : `zone:${item.zoneId}`),
        ),
      );
    },
    [onSelectionChange, safeSelection],
  );

  const buy = useCallback(
    async (valid: boolean) => {
      if (locked || pending || !valid) return;
      const submittedContext = contextKey;
      setError(null);
      setPending(true);
      try {
        await onBuyClick({ occurrenceId, selection: [...selection] });
      } catch (cause) {
        const failure = cause instanceof Error ? cause : new Error(String(cause));
        if (latestContext.current === submittedContext) {
          setError(failure.message);
          onError?.(failure);
        }
      } finally {
        if (latestContext.current === submittedContext) setPending(false);
      }
    },
    [contextKey, locked, occurrenceId, onBuyClick, onError, pending, selection],
  );

  return {
    safeSelection,
    selectedSeatIds,
    pending,
    error,
    setError,
    handleSeatClick,
    handleQuantityChange,
    removeSelection,
    buy,
  };
}

export function selectionIssueMessage(
  code: SelectionValidationIssueCode,
  labels: Readonly<{
    missingPrice: string;
    invalidPrice: string;
    duplicate: string;
    mixedCurrencies: string;
    invalidQuantity: string;
    invalidSelection: string;
  }>,
): string {
  if (code === 'missing_price') return labels.missingPrice;
  if (code === 'invalid_price' || code === 'total_overflow')
    return labels.invalidPrice;
  if (code === 'duplicate_item') return labels.duplicate;
  if (code === 'mixed_currencies') return labels.mixedCurrencies;
  if (code === 'invalid_quantity' || code.startsWith('quantity_'))
    return labels.invalidQuantity;
  return labels.invalidSelection;
}

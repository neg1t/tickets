import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSeatSelectionContext } from './SeatSelectionProvider.js';
import {
  validateSelection,
  type SelectionValidationIssueCode,
  type SelectionValidationResult,
} from './selectionValidation.js';
import type {
  PublishedHallLayout,
  SeatAvailabilityMap,
  SeatPriceMap,
  SeatSelectionItem,
  SeatViewData,
} from './SeatView.js';

export type UseSeatSelectionOptions = Readonly<{
  readonly layout: PublishedHallLayout;
  readonly availability: SeatAvailabilityMap;
  readonly prices: SeatPriceMap;
  readonly locked?: boolean;
  readonly contextKey?: string;
  readonly seatIds?: Pick<ReadonlySet<string>, 'has'>;
  readonly zoneIds?: Pick<ReadonlySet<string>, 'has'>;
}>;

export type SeatSelectionController = Readonly<{
  selection: readonly SeatSelectionItem[];
  ownHoldSelection: readonly SeatSelectionItem[];
  safeSelection: readonly SeatSelectionItem[];
  selectedSeatIds: ReadonlySet<string>;
  validation: SelectionValidationResult;
  actionError: SelectionValidationIssueCode | null;
  clearActionError: () => void;
  toggleSeat: (seatId: string) => boolean;
  setGeneralAdmissionQuantity: (
    zoneId: string,
    value: string | number,
  ) => boolean;
  removeSelection: (key: string) => boolean;
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

/**
 * Shared, controlled selection actions for the map, accessible list and basket.
 * Checkout, navigation and renderer state live outside this hook.
 */
export function useSeatSelection({
  layout,
  availability,
  prices,
  locked = false,
  contextKey = '',
  seatIds,
  zoneIds,
}: UseSeatSelectionOptions): SeatSelectionController {
  const context = useSeatSelectionContext();
  const [actionError, setActionError] = useState<SelectionValidationIssueCode | null>(null);
  const clearActionError = useCallback(() => setActionError(null), []);
  const previousContext = useRef(contextKey);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setActionError(null);
  }, [contextKey]);

  const safeSelection = useMemo(
    () => context.selection.filter(isSelectionItem),
    [context.selection],
  );
  const ownHoldSelection = useMemo(
    () => context.ownHoldSelection.filter(isSelectionItem),
    [context.ownHoldSelection],
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
  const validate = useCallback(
    (selection: readonly SeatSelectionItem[]) =>
      validateSelection({
        layout,
        selection,
        availability,
        prices,
        ownHoldSelection,
        ...(seatIds ? { seatIds } : {}),
        ...(zoneIds ? { zoneIds } : {}),
      }),
    [layout, availability, prices, ownHoldSelection, seatIds, zoneIds],
  );
  const validation = useMemo(
    () => validate(context.selection),
    [context.selection, validate],
  );

  const toggleSeat = useCallback(
    (seatId: string) => {
      if (locked) return false;
      if (selectedSeatIds.has(seatId)) {
        context.onSelectionChange(
          safeSelection.filter(
            (item) => item.kind !== 'seat' || item.seatId !== seatId,
          ),
        );
        setActionError(null);
        return true;
      }

      const candidate = [...safeSelection, { kind: 'seat' as const, seatId }];
      const issue = validate(candidate).issues.find(
        (entry) => entry.kind === 'seat' && entry.id === seatId,
      );
      if (issue) {
        setActionError(issue.code);
        return false;
      }

      context.onSelectionChange(candidate);
      setActionError(null);
      return true;
    },
    [context, locked, safeSelection, selectedSeatIds, validate],
  );

  const setGeneralAdmissionQuantity = useCallback(
    (zoneId: string, value: string | number) => {
      if (locked) return false;
      const quantity = typeof value === 'string' ? Number(value) : value;
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        setActionError('invalid_quantity');
        return false;
      }

      const withoutZone = safeSelection.filter(
        (item) => item.kind !== 'generalAdmission' || item.zoneId !== zoneId,
      );
      if (quantity === 0) {
        context.onSelectionChange(withoutZone);
        setActionError(null);
        return true;
      }

      const candidate = [
        ...withoutZone,
        { kind: 'generalAdmission' as const, zoneId, quantity },
      ];
      const issue = validate(candidate).issues.find(
        (entry) => entry.kind === 'generalAdmission' && entry.id === zoneId,
      );
      if (issue) {
        setActionError(issue.code);
        return false;
      }

      context.onSelectionChange(candidate);
      setActionError(null);
      return true;
    },
    [context, locked, safeSelection, validate],
  );

  const removeSelection = useCallback(
    (key: string) => {
      if (locked) return false;
      const nextSelection = safeSelection.filter(
        (item) =>
          key !==
          (item.kind === 'seat'
            ? `seat:${item.seatId}`
            : `zone:${item.zoneId}`),
      );
      if (nextSelection.length === safeSelection.length) return false;
      context.onSelectionChange(
        nextSelection,
      );
      setActionError(null);
      return true;
    },
    [context, locked, safeSelection],
  );

  return {
    selection: context.selection,
    ownHoldSelection,
    safeSelection,
    selectedSeatIds,
    validation,
    actionError,
    clearActionError,
    toggleSeat,
    setGeneralAdmissionQuantity,
    removeSelection,
  };
}

type SeatCheckoutOptions = Readonly<{
  contextKey: string;
  occurrenceId: string;
  selection: readonly SeatSelectionItem[];
  locked: boolean;
  onBuyClick: (data: SeatViewData) => void | Promise<void>;
  onError?: (error: Error) => void;
}>;

/** SeatView-specific submission state, separate from reusable selection actions. */
export function useSeatCheckoutController({
  contextKey,
  occurrenceId,
  selection,
  locked,
  onBuyClick,
  onError,
}: SeatCheckoutOptions) {
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

  return { pending, error, buy };
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

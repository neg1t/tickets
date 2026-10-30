import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react';
import type { SeatSelectionItem } from './SeatView.js';

export type SeatSelectionContextValue = Readonly<{
  selection: readonly SeatSelectionItem[];
  ownHoldSelection: readonly SeatSelectionItem[];
  onSelectionChange: (selection: SeatSelectionItem[]) => void;
}>;

const SeatSelectionContext = createContext<SeatSelectionContextValue | null>(
  null,
);

export type SeatSelectionProviderProps = PropsWithChildren<{
  readonly selection: readonly SeatSelectionItem[];
  readonly ownHoldSelection?: readonly SeatSelectionItem[];
  readonly onSelectionChange: (selection: SeatSelectionItem[]) => void;
}>;

/** Shares the host-controlled ticket selection with the map and adjacent UI. */
export function SeatSelectionProvider({
  children,
  selection,
  ownHoldSelection = [],
  onSelectionChange,
}: SeatSelectionProviderProps) {
  const value = useMemo(
    () => ({ selection, ownHoldSelection, onSelectionChange }),
    [onSelectionChange, ownHoldSelection, selection],
  );

  return (
    <SeatSelectionContext.Provider value={value}>
      {children}
    </SeatSelectionContext.Provider>
  );
}

export function useSeatSelectionContext(): SeatSelectionContextValue {
  const value = useContext(SeatSelectionContext);
  if (!value) {
    throw new Error('Seat selection components must be inside SeatSelectionProvider');
  }
  return value;
}

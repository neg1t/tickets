import { describe, expect, it } from 'vitest';
import type { HallTarget } from './hallTarget.js';
import {
  applySelectionOperation,
  isSelectionTargetAllowed,
  type SelectionOperation,
} from './selectionPolicy.js';

const seat: HallTarget = { kind: 'seat', id: 'seat-1' };
const row: HallTarget = { kind: 'row', id: 'row-1' };
const otherSeat: HallTarget = { kind: 'seat', id: 'seat-2' };

describe('selection policy', () => {
  it('preserves existing kinds when no selection filter is provided', () => {
    expect(isSelectionTargetAllowed(row)).toBe(true);
    expect(isSelectionTargetAllowed(seat, new Set(['seat']))).toBe(true);
    expect(isSelectionTargetAllowed(row, new Set(['seat']))).toBe(false);
  });

  it.each<SelectionOperation>(['replace', 'add', 'subtract', 'toggle'])(
    'applies %s to unique target IDs',
    (operation) => {
      const result = applySelectionOperation(
        [seat, row],
        [otherSeat, seat],
        operation,
      );
      expect(result.filter(({ kind, id }) => kind === 'seat' && id === 'seat-1'))
        .toHaveLength(operation === 'toggle' || operation === 'subtract' ? 0 : 1);
      expect(new Set(result.map(({ kind, id }) => `${kind}:${id}`)).size).toBe(
        result.length,
      );
    },
  );

  it('adds and subtracts without requiring keyboard modifiers', () => {
    expect(applySelectionOperation([seat], [otherSeat], 'add')).toEqual([
      seat,
      otherSeat,
    ]);
    expect(applySelectionOperation([seat, otherSeat], [seat], 'subtract')).toEqual([
      otherSeat,
    ]);
  });
});

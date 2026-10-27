import type { Seat } from '@hall-platform/domain';
import { seatLevelOfDetail } from './furniture.js';

export type DotSeatBatch = Readonly<{
  seats: readonly Seat[];
  fills: readonly string[];
}>;

export function groupDotSeats(
  seats: readonly Seat[],
  scale: number,
  appearance: Readonly<Record<string, { fill: string }>>,
  defaultFill: string,
): readonly DotSeatBatch[] | null {
  if (seats.some((seat) => seatLevelOfDetail(scale, seat.visualKind) !== 'dot'))
    return null;
  return [
    {
      seats: [...seats],
      fills: seats.map((seat) => appearance[seat.id]?.fill ?? defaultFill),
    },
  ];
}

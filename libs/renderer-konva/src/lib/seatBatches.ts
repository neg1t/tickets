import type { Seat } from '@hall-platform/domain';
import { seatLevelOfDetail } from './furniture.js';

export type DotSeatBatch = Readonly<{
  fill: string;
  seats: readonly Seat[];
}>;

export function groupDotSeats(
  seats: readonly Seat[],
  scale: number,
  appearance: Readonly<Record<string, { fill: string }>>,
  defaultFill: string,
): readonly DotSeatBatch[] | null {
  if (seats.some((seat) => seatLevelOfDetail(scale, seat.visualKind) !== 'dot'))
    return null;
  const batches: { fill: string; seats: Seat[] }[] = [];
  for (const seat of seats) {
    const fill = appearance[seat.id]?.fill ?? defaultFill;
    const last = batches[batches.length - 1];
    if (last?.fill === fill) last.seats.push(seat);
    else batches.push({ fill, seats: [seat] });
  }
  return batches;
}

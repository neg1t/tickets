import type { Seat, Table } from '@hall-platform/domain';
import { SeatSymbol, TableSymbol } from './FurnitureSymbols.js';

type Colors = Readonly<{ fill: string; stroke: string }>;
export type ObjectRendererProps = Readonly<{
  object: Seat | Table;
  colors: Colors;
}>;

export function ObjectRenderer({ object, colors }: ObjectRendererProps) {
  return 'position' in object ? (
    <SeatSymbol seat={object} colors={colors} />
  ) : (
    <TableSymbol table={object} colors={colors} />
  );
}

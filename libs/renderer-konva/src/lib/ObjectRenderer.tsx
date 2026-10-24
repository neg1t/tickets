import type { Seat, Table } from '@hall-platform/domain';
import { SeatSymbol, TableSymbol } from './FurnitureSymbols.js';

type Colors = Readonly<{ fill: string; stroke: string }>;
export type ObjectRendererProps = Readonly<{
  object: Seat | Table;
  colors: Colors;
  scale: number;
}>;

export function ObjectRenderer({ object, colors, scale }: ObjectRendererProps) {
  return 'position' in object ? (
    <SeatSymbol seat={object} colors={colors} scale={scale} />
  ) : (
    <TableSymbol table={object} colors={colors} />
  );
}

import type { Seat, Table } from '@hall-platform/domain';
import { Circle, Rect, Text } from 'react-konva';
import { seatSymbolDiameter } from './furniture.js';

type SymbolColors = Readonly<{ fill: string; stroke: string }>;

export function SeatSymbol({
  seat,
  colors,
}: Readonly<{ seat: Seat; colors: SymbolColors }>) {
  const isWheelchairBay = seat.visualKind === 'wheelchairBay';
  return (
    <Circle
      x={seat.position.x}
      y={seat.position.y}
      radius={seatSymbolDiameter(seat.visualKind) / 2}
      fill={colors.fill}
      stroke={colors.stroke}
      strokeWidth={isWheelchairBay ? 0.12 : 0.1}
      {...(isWheelchairBay ? { dash: [0.2, 0.12] } : {})}
    />
  );
}

export function TableSymbol({
  table,
  colors,
}: Readonly<{ table: Table; colors: SymbolColors }>) {
  return table.shape.kind === 'circle' ? (
    <Circle
      x={table.center.x}
      y={table.center.y}
      radius={table.shape.radius}
      fill={colors.fill}
      stroke={colors.stroke}
      strokeWidth={0.14}
    />
  ) : (
    <Rect
      x={table.center.x}
      y={table.center.y}
      offsetX={table.shape.width / 2}
      offsetY={table.shape.height / 2}
      width={table.shape.width}
      height={table.shape.height}
      rotation={(table.rotationRadians * 180) / Math.PI}
      fill={colors.fill}
      stroke={colors.stroke}
      strokeWidth={0.14}
    />
  );
}

export function SeatLabel({ seat }: Readonly<{ seat: Seat }>) {
  return (
    <Text
      x={seat.position.x - 0.65}
      y={seat.position.y - 0.24}
      width={1.3}
      align="center"
      text={seat.label}
      fill="white"
      fontSize={0.52}
      listening={false}
    />
  );
}

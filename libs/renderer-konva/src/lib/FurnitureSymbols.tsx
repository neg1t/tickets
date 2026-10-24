import type { Seat, Table } from '@hall-platform/domain';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { seatLevelOfDetail, type SeatLevelOfDetail } from './furniture.js';

type SymbolColors = Readonly<{ fill: string; stroke: string }>;
type SeatSymbolProps = Readonly<{
  seat: Seat;
  colors: SymbolColors;
  detail: SeatLevelOfDetail;
}>;

function SeatGroup({
  seat,
  children,
}: Readonly<{ seat: Seat; children: React.ReactNode }>) {
  return (
    <Group
      x={seat.position.x}
      y={seat.position.y}
      rotation={((seat.rotationRadians ?? 0) * 180) / Math.PI}
    >
      {children}
    </Group>
  );
}

export function ChairSymbol({ seat, colors, detail }: SeatSymbolProps) {
  if (detail === 'dot')
    return (
      <Circle
        x={seat.position.x}
        y={seat.position.y}
        radius={0.3}
        fill={colors.fill}
      />
    );
  return (
    <SeatGroup seat={seat}>
      <Rect
        x={-0.55}
        y={-0.48}
        width={1.1}
        height={1.03}
        cornerRadius={0.12}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={0.1}
      />
      <Rect
        x={-0.65}
        y={-0.75}
        width={1.3}
        height={0.27}
        cornerRadius={0.08}
        fill={colors.stroke}
      />
      <Rect x={-0.4} y={0.55} width={0.8} height={0.2} fill={colors.fill} />
      {detail === 'full' && (
        <Line
          points={[-0.45, 0.3, 0.45, 0.3]}
          stroke={colors.stroke}
          strokeWidth={0.07}
        />
      )}
    </SeatGroup>
  );
}

export function ArmchairSymbol({ seat, colors, detail }: SeatSymbolProps) {
  if (detail === 'dot')
    return (
      <Circle
        x={seat.position.x}
        y={seat.position.y}
        radius={0.35}
        fill={colors.fill}
      />
    );
  return (
    <SeatGroup seat={seat}>
      <Rect
        x={-0.55}
        y={-0.55}
        width={1.1}
        height={1.2}
        cornerRadius={0.2}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={0.1}
      />
      <Rect
        x={-0.75}
        y={-0.75}
        width={1.5}
        height={0.23}
        cornerRadius={0.1}
        fill={colors.stroke}
      />
      <Rect
        x={-0.75}
        y={-0.5}
        width={0.2}
        height={1}
        cornerRadius={0.08}
        fill={colors.stroke}
      />
      <Rect
        x={0.55}
        y={-0.5}
        width={0.2}
        height={1}
        cornerRadius={0.08}
        fill={colors.stroke}
      />
      {detail === 'full' && (
        <Line
          points={[-0.45, 0.36, 0.45, 0.36]}
          stroke={colors.stroke}
          strokeWidth={0.07}
        />
      )}
    </SeatGroup>
  );
}

export function WheelchairBaySymbol({ seat, colors, detail }: SeatSymbolProps) {
  if (detail === 'dot')
    return (
      <Circle
        x={seat.position.x}
        y={seat.position.y}
        radius={0.38}
        fill={colors.fill}
      />
    );
  return (
    <SeatGroup seat={seat}>
      <Rect
        x={-0.8}
        y={-0.8}
        width={1.6}
        height={1.6}
        cornerRadius={0.12}
        fill={colors.fill}
        stroke={colors.stroke}
        strokeWidth={0.12}
        dash={[0.2, 0.12]}
      />
      {detail === 'full' && (
        <>
          <Circle x={0} y={-0.42} radius={0.16} fill={colors.stroke} />
          <Line
            points={[0, -0.22, 0, 0.26, 0.4, 0.26]}
            stroke={colors.stroke}
            strokeWidth={0.13}
            lineCap="round"
            lineJoin="round"
          />
          <Circle
            x={-0.08}
            y={0.27}
            radius={0.38}
            stroke={colors.stroke}
            strokeWidth={0.1}
          />
        </>
      )}
    </SeatGroup>
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

export function SeatSymbol({
  seat,
  colors,
  scale,
}: Readonly<{ seat: Seat; colors: SymbolColors; scale: number }>) {
  const props = {
    seat,
    colors,
    detail: seatLevelOfDetail(scale, seat.visualKind),
  };
  switch (seat.visualKind) {
    case 'armchair':
      return <ArmchairSymbol {...props} />;
    case 'wheelchairBay':
      return <WheelchairBaySymbol {...props} />;
    default:
      return <ChairSymbol {...props} />;
  }
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

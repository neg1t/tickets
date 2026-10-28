import type { SpatialBounds } from '@hall-platform/geometry';
import { Circle, Rect } from 'react-konva';

export function SelectionOverlay({
  bounds,
  color,
  shape = 'rectangle',
  padding = 0.2,
  strokeWidth = 0.2,
}: Readonly<{
  bounds: SpatialBounds;
  color: string;
  shape?: 'circle' | 'rectangle';
  padding?: number;
  strokeWidth?: number;
}>) {
  if (shape === 'circle')
    return (
      <Circle
        x={(bounds.minX + bounds.maxX) / 2}
        y={(bounds.minY + bounds.maxY) / 2}
        radius={
          Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2 +
          padding
        }
        stroke={color}
        strokeWidth={strokeWidth}
      />
    );
  return (
    <Rect
      x={bounds.minX - padding}
      y={bounds.minY - padding}
      width={bounds.maxX - bounds.minX + 2 * padding}
      height={bounds.maxY - bounds.minY + 2 * padding}
      stroke={color}
      strokeWidth={strokeWidth}
      cornerRadius={0.3}
    />
  );
}

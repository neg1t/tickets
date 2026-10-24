import type { SpatialBounds } from '@hall-platform/geometry';
import { Rect } from 'react-konva';

export function SelectionOverlay({
  bounds,
  color,
}: Readonly<{ bounds: SpatialBounds; color: string }>) {
  return (
    <Rect
      x={bounds.minX - 0.2}
      y={bounds.minY - 0.2}
      width={bounds.maxX - bounds.minX + 0.4}
      height={bounds.maxY - bounds.minY + 0.4}
      stroke={color}
      strokeWidth={0.2}
      cornerRadius={0.3}
    />
  );
}

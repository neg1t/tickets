import type { ReactNode } from 'react';
import { Group } from 'react-konva';
import type { Vector2 } from '@hall-platform/geometry';

export function DragPreview({
  delta,
  children,
}: {
  readonly delta: Vector2;
  readonly children: ReactNode;
}) {
  return (
    <Group name="drag-preview" x={delta.x} y={delta.y}>
      {children}
    </Group>
  );
}

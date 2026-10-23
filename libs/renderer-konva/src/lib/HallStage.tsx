import { forwardRef, type ComponentProps } from 'react';
import type Konva from 'konva';
import { Stage } from 'react-konva';

export type HallStageProps = Omit<
  ComponentProps<typeof Stage>,
  'width' | 'height'
> & {
  readonly width: number;
  readonly height: number;
};

export const HallStage = forwardRef<Konva.Stage, HallStageProps>(
  function HallStage({ width, height, children, ...stageProps }, ref) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new RangeError('Stage dimensions must be positive and finite');
    }

    return (
      <Stage ref={ref} width={width} height={height} {...stageProps}>
        {children}
      </Stage>
    );
  },
);

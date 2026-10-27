import type { Seat } from '@hall-platform/domain';
import {
  seatSymbolWidth,
  seatLevelOfDetail,
  type RendererSeatGeometry,
} from '@hall-platform/renderer-core';
import type { Vector2 } from '@hall-platform/geometry';
export type { SeatLevelOfDetail } from '@hall-platform/renderer-core';
export {
  hitSeatSymbol,
  seatSymbolBounds,
  seatSymbolDiameter,
  seatSymbolParts,
  seatSymbolWidth,
} from '@hall-platform/renderer-core';

export type SeatVisualKind = NonNullable<Seat['visualKind']>;
export type SeatFurniture = RendererSeatGeometry;
export { seatLevelOfDetail };

export function shouldShowSeatLabel(
  label: string,
  diameter: number,
  scale: number,
  pitchPx = Infinity,
): boolean {
  const projectedDiameter = diameter * scale;
  const requiredWidth = Math.max(12, label.length * 0.52 * 0.62 * scale);
  return projectedDiameter >= requiredWidth + 4 && pitchPx >= requiredWidth + 4;
}

export function visibleSeatLabelIds(
  seats: readonly Readonly<{
    id: string;
    label: string;
    position: Vector2;
    visualKind?: SeatVisualKind | undefined;
  }>[],
  scale: number,
  viewport?: Readonly<{ x: number; y: number; width: number; height: number }>,
): ReadonlySet<string> {
  const cellSize = 64;
  const cells = new Map<string, number[]>();
  const placed: { left: number; right: number; top: number; bottom: number }[] =
    [];
  const visible = new Set<string>();
  for (const seat of seats) {
    if (
      !shouldShowSeatLabel(seat.label, seatSymbolWidth(seat.visualKind), scale)
    )
      continue;
    const x = seat.position.x * scale + (viewport?.x ?? 0);
    const y = seat.position.y * scale + (viewport?.y ?? 0);
    const width = Math.max(12, seat.label.length * 0.52 * 0.62 * scale);
    const height = Math.max(16, 0.52 * scale + 3);
    const box = {
      left: x - width / 2 - 1.5,
      right: x + width / 2 + 1.5,
      top: y - height / 2,
      bottom: y + height / 2,
    };
    if (
      viewport &&
      (box.right < 0 ||
        box.left > viewport.width ||
        box.bottom < 0 ||
        box.top > viewport.height)
    )
      continue;
    const minCellX = Math.floor(box.left / cellSize);
    const maxCellX = Math.floor(box.right / cellSize);
    const minCellY = Math.floor(box.top / cellSize);
    const maxCellY = Math.floor(box.bottom / cellSize);
    const keys: string[] = [];
    const candidates = new Set<number>();
    for (let cellX = minCellX; cellX <= maxCellX; cellX++)
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const key = `${cellX}:${cellY}`;
        keys.push(key);
        for (const candidate of cells.get(key) ?? []) candidates.add(candidate);
      }
    if (
      [...candidates].some((index) => {
        const prior = placed[index];
        return (
          prior &&
          box.left < prior.right &&
          box.right > prior.left &&
          box.top < prior.bottom &&
          box.bottom > prior.top
        );
      })
    )
      continue;
    const index = placed.push(box) - 1;
    for (const key of keys) cells.set(key, [...(cells.get(key) ?? []), index]);
    visible.add(seat.id);
  }
  return visible;
}

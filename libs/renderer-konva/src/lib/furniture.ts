import type { Seat } from '@hall-platform/domain';
import {
  levelOfDetailForPixels,
  type SeatLevelOfDetail,
} from '@hall-platform/renderer-core';
import type { SpatialBounds, Vector2 } from '@hall-platform/geometry';
export type { SeatLevelOfDetail } from '@hall-platform/renderer-core';

export type SeatVisualKind = NonNullable<Seat['visualKind']>;
export type SeatFurniture = Readonly<{
  position: Vector2;
  rotationRadians?: number | undefined;
  visualKind?: SeatVisualKind | undefined;
}>;
type Rect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

// Symbols are centered at the seat position; the back of a chair faces local -Y.
const chairParts: readonly Rect[] = [
  { left: -0.55, right: 0.55, top: -0.48, bottom: 0.55 },
  { left: -0.65, right: 0.65, top: -0.75, bottom: -0.48 },
  { left: -0.4, right: 0.4, top: 0.55, bottom: 0.75 },
];
const armchairParts: readonly Rect[] = [
  { left: -0.55, right: 0.55, top: -0.55, bottom: 0.65 },
  { left: -0.75, right: 0.75, top: -0.75, bottom: -0.52 },
  { left: -0.75, right: -0.55, top: -0.5, bottom: 0.5 },
  { left: 0.55, right: 0.75, top: -0.5, bottom: 0.5 },
];
const bayParts: readonly Rect[] = [
  { left: -0.8, right: 0.8, top: -0.8, bottom: 0.8 },
];

export function seatSymbolParts(
  kind: SeatVisualKind = 'chair',
): readonly Rect[] {
  return kind === 'armchair'
    ? armchairParts
    : kind === 'wheelchairBay'
      ? bayParts
      : chairParts;
}

function localPoint(seat: SeatFurniture, point: Vector2): Vector2 {
  const angle = seat.rotationRadians ?? 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - seat.position.x;
  const dy = point.y - seat.position.y;
  return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine };
}

export function hitSeatSymbol(
  seat: SeatFurniture,
  point: Vector2,
  tolerance = 0,
): boolean {
  const local = localPoint(seat, point);
  return seatSymbolParts(seat.visualKind).some(
    (part) =>
      local.x >= part.left - tolerance &&
      local.x <= part.right + tolerance &&
      local.y >= part.top - tolerance &&
      local.y <= part.bottom + tolerance,
  );
}

export function seatSymbolBounds(seat: SeatFurniture): SpatialBounds {
  const angle = seat.rotationRadians ?? 0;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const corners = seatSymbolParts(seat.visualKind).flatMap((part) =>
    [
      [part.left, part.top],
      [part.right, part.top],
      [part.right, part.bottom],
      [part.left, part.bottom],
    ].map(([x = 0, y = 0]) => ({
      x: seat.position.x + x * cosine - y * sine,
      y: seat.position.y + x * sine + y * cosine,
    })),
  );
  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
  };
}

export function seatSymbolDiameter(kind: SeatVisualKind = 'chair'): number {
  return kind === 'wheelchairBay' ? 1.6 : 1.5;
}

export function seatSymbolWidth(kind: SeatVisualKind = 'chair'): number {
  return kind === 'wheelchairBay' ? 1.6 : kind === 'armchair' ? 1.5 : 1.3;
}

export function seatLevelOfDetail(
  scale: number,
  kind: SeatVisualKind = 'chair',
): SeatLevelOfDetail {
  const projectedDiameter = seatSymbolDiameter(kind) * scale;
  return levelOfDetailForPixels(projectedDiameter, {
    silhouette: 6,
    full: 22,
  });
}

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

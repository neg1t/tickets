import type { SpatialBounds, Vector2 } from '@hall-platform/geometry';
import type { SeatLevelOfDetail } from './lod.js';
import { levelOfDetailForPixels } from './lod.js';
import type { RendererSeatGeometry } from './rendererContract.js';

export type SeatVisualKind = NonNullable<RendererSeatGeometry['visualKind']>;
export type SeatFurniture = RendererSeatGeometry;
type Rect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

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

/** @deprecated Seat symbols are circles; use seatSymbolDiameter instead. */
export function seatSymbolParts(
  kind: SeatVisualKind = 'chair',
): readonly Rect[] {
  return kind === 'armchair'
    ? armchairParts
    : kind === 'wheelchairBay'
      ? bayParts
      : chairParts;
}

export function hitSeatSymbol(
  seat: SeatFurniture,
  point: Vector2,
  tolerance = 0,
): boolean {
  const radius = seatSymbolDiameter(seat.visualKind) / 2 + tolerance;
  return (
    Math.hypot(point.x - seat.position.x, point.y - seat.position.y) <= radius
  );
}

export function seatSymbolBounds(seat: SeatFurniture): SpatialBounds {
  const radius = seatSymbolDiameter(seat.visualKind) / 2;
  return {
    minX: seat.position.x - radius,
    minY: seat.position.y - radius,
    maxX: seat.position.x + radius,
    maxY: seat.position.y + radius,
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
  return levelOfDetailForPixels(seatSymbolDiameter(kind) * scale, {
    silhouette: 6,
    full: 22,
  });
}

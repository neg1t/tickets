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

function boundsOfPoints(points: readonly Vector2[]): SpatialBounds {
  const first = points[0] ?? { x: 0, y: 0 };
  return points.slice(1).reduce<SpatialBounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y },
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
  return boundsOfPoints(corners);
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

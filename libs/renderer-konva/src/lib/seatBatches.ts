import type { SpatialBounds } from '@hall-platform/geometry';
import type { Seat } from '@hall-platform/domain';
import { seatLevelOfDetail } from './furniture.js';

const spatialBlockSize = 256;
const overlapCellSize = 1;
const maxDotSeatRadius = 0.38;
let batchBuildSequence = 0;

type SeatAppearance = Readonly<Record<string, { fill: string }>>;
type DotSeatBatchGeometry = Readonly<{
  key: string;
  firstIndex: number;
  seats: readonly Seat[];
  bounds: SpatialBounds;
}>;

export type DotSeatBatch = Readonly<{
  key: string;
  seats: readonly Seat[];
  fills: readonly string[];
  bounds: SpatialBounds;
}>;

function mergeBounds(
  first: SpatialBounds,
  second: SpatialBounds,
): SpatialBounds {
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

function boundsIntersect(first: SpatialBounds, second: SpatialBounds): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

function dotSeatRadius(seat: Seat): number {
  return seat.visualKind === 'wheelchairBay'
    ? 0.38
    : seat.visualKind === 'armchair'
      ? 0.35
      : 0.3;
}

function dotSeatBounds(seat: Seat): SpatialBounds {
  const radius = dotSeatRadius(seat);
  return {
    minX: seat.position.x - radius,
    minY: seat.position.y - radius,
    maxX: seat.position.x + radius,
    maxY: seat.position.y + radius,
  };
}

export class DotSeatBatcher {
  private geometrySeats: readonly Seat[] | null = null;
  private geometry: readonly DotSeatBatchGeometry[] = [];
  private batches: readonly DotSeatBatch[] = [];
  private appearance: SeatAppearance | null = null;
  private defaultFill: string | null = null;
  private lodSeats: readonly Seat[] | null = null;
  private lodScale: number | null = null;
  private isDotDetail = false;

  build(
    seats: readonly Seat[],
    scale: number,
    appearance: SeatAppearance,
    defaultFill: string,
    visibleBounds?: SpatialBounds,
    excludedSeatIds: ReadonlySet<string> = new Set(),
  ): readonly DotSeatBatch[] | null {
    if (this.lodSeats !== seats || this.lodScale !== scale) {
      this.isDotDetail = !seats.some(
        (seat) => seatLevelOfDetail(scale, seat.visualKind) !== 'dot',
      );
      this.lodSeats = seats;
      this.lodScale = scale;
    }
    if (!this.isDotDetail) return null;

    if (this.geometrySeats !== seats) {
      this.geometrySeats = seats;
      this.geometry = this.buildGeometry(seats);
      this.batches = [];
      this.appearance = null;
      this.defaultFill = null;
    }

    if (this.appearance !== appearance || this.defaultFill !== defaultFill) {
      this.batches = this.geometry.map((batch, batchIndex) => {
        const previous = this.batches[batchIndex];
        let nextFills: string[] | null = previous ? null : [];
        for (let index = 0; index < batch.seats.length; index++) {
          const seat = batch.seats[index];
          if (!seat) continue;
          const fill = appearance[seat.id]?.fill ?? defaultFill;
          if (!previous) {
            nextFills?.push(fill);
          } else if (previous.fills[index] !== fill) {
            if (!nextFills) nextFills = [...previous.fills];
            nextFills[index] = fill;
          }
        }
        if (previous && !nextFills) return previous;
        return {
          key: batch.key,
          seats: batch.seats,
          fills: nextFills ?? [],
          bounds: batch.bounds,
        };
      });
      this.appearance = appearance;
      this.defaultFill = defaultFill;
    }

    const visibleBatches = visibleBounds
      ? this.batches.filter((batch) =>
          boundsIntersect(batch.bounds, visibleBounds),
        )
      : this.batches;
    if (excludedSeatIds.size === 0) return visibleBatches;

    return visibleBatches.flatMap((batch) => {
      if (!batch.seats.some((seat) => excludedSeatIds.has(seat.id)))
        return [batch];
      const filteredSeats: Seat[] = [];
      const filteredFills: string[] = [];
      for (let index = 0; index < batch.seats.length; index += 1) {
        const seat = batch.seats[index];
        if (!seat || excludedSeatIds.has(seat.id)) continue;
        filteredSeats.push(seat);
        const fill = batch.fills[index];
        if (fill !== undefined) filteredFills.push(fill);
      }
      return filteredSeats.length > 0
        ? [{ ...batch, seats: filteredSeats, fills: filteredFills }]
        : [];
    });
  }

  private buildGeometry(
    seats: readonly Seat[],
  ): readonly DotSeatBatchGeometry[] {
    const measureName =
      seats.length >= 5_000
        ? `hall:seat-batches:${seats.length}:${++batchBuildSequence}`
        : '';
    if (measureName) globalThis.performance?.mark(`${measureName}:start`);
    const parent = new Map<string, string>();
    const blockBySeat = new Array<string>(seats.length);
    const boundsBySeat = new Array<SpatialBounds>(seats.length);
    const overlapCells = new Map<string, Map<string, SpatialBounds[]>>();

    function find(key: string): string {
      const current = parent.get(key);
      if (current === undefined || current === key) return key;
      const root = find(current);
      parent.set(key, root);
      return root;
    }

    function union(first: string, second: string): void {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot === secondRoot) return;
      const [root, child] =
        firstRoot < secondRoot
          ? [firstRoot, secondRoot]
          : [secondRoot, firstRoot];
      parent.set(child, root);
    }

    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index];
      if (!seat) continue;
      const blockX = Math.floor(seat.position.x / spatialBlockSize);
      const blockY = Math.floor(seat.position.y / spatialBlockSize);
      const blockKey = `block:${blockX}:${blockY}`;
      if (!parent.has(blockKey)) parent.set(blockKey, blockKey);
      blockBySeat[index] = blockKey;

      const bounds = dotSeatBounds(seat);
      boundsBySeat[index] = bounds;
      const distanceToBoundary = Math.min(
        seat.position.x - blockX * spatialBlockSize,
        (blockX + 1) * spatialBlockSize - seat.position.x,
        seat.position.y - blockY * spatialBlockSize,
        (blockY + 1) * spatialBlockSize - seat.position.y,
      );
      if (distanceToBoundary > dotSeatRadius(seat) + maxDotSeatRadius) continue;

      const minCellX = Math.floor(bounds.minX / overlapCellSize);
      const minCellY = Math.floor(bounds.minY / overlapCellSize);
      const maxCellX = Math.floor(bounds.maxX / overlapCellSize);
      const maxCellY = Math.floor(bounds.maxY / overlapCellSize);
      const occupiedCells: string[] = [];
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          const cellKey = `${cellX}:${cellY}`;
          occupiedCells.push(cellKey);
          const occupants = overlapCells.get(cellKey);
          if (occupants) {
            for (const [occupant, previousBounds] of occupants) {
              if (
                occupant !== blockKey &&
                previousBounds.some((previous) =>
                  boundsIntersect(previous, bounds),
                )
              )
                union(blockKey, occupant);
            }
          }
        }
      }
      for (const cellKey of occupiedCells) {
        const occupants = overlapCells.get(cellKey) ?? new Map();
        const blockBounds = occupants.get(blockKey) ?? [];
        blockBounds.push(bounds);
        occupants.set(blockKey, blockBounds);
        overlapCells.set(cellKey, occupants);
      }
    }

    const components = new Map<
      string,
      { firstIndex: number; seats: Seat[]; bounds: SpatialBounds }
    >();
    for (let index = 0; index < seats.length; index++) {
      const seat = seats[index];
      const blockKey = blockBySeat[index];
      const bounds = boundsBySeat[index];
      if (!seat || !blockKey || !bounds) continue;
      const key = find(blockKey);
      const component = components.get(key);
      if (!component) {
        components.set(key, { firstIndex: index, seats: [seat], bounds });
      } else {
        component.seats.push(seat);
        component.bounds = mergeBounds(component.bounds, bounds);
      }
    }

    const geometry = [...components.entries()]
      .sort(([, first], [, second]) => first.firstIndex - second.firstIndex)
      .map(([key, component]) => ({ key, ...component }));
    if (measureName) {
      globalThis.performance?.mark(`${measureName}:end`);
      globalThis.performance?.measure(
        measureName,
        `${measureName}:start`,
        `${measureName}:end`,
      );
    }
    return geometry;
  }
}

export function groupDotSeats(
  seats: readonly Seat[],
  scale: number,
  appearance: SeatAppearance,
  defaultFill: string,
): readonly DotSeatBatch[] | null {
  return new DotSeatBatcher().build(seats, scale, appearance, defaultFill);
}

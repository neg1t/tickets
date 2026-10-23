import type { Vector2 } from './vector.js';

export type SpatialBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type SpatialIndexEntry<T> = {
  readonly id: string;
  readonly bounds: SpatialBounds;
  readonly value: T;
};

type StoredEntry<T> = SpatialIndexEntry<T> & {
  readonly cellKeys: readonly string[] | null;
};

const maxQueryCells = 4_096;

function copyValidBounds(bounds: SpatialBounds): SpatialBounds {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    throw new RangeError('Spatial bounds must be finite and ordered');
  }
  return { ...bounds };
}

function boundsIntersect(first: SpatialBounds, second: SpatialBounds): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

function snapshot<T>(entry: SpatialIndexEntry<T>): SpatialIndexEntry<T> {
  return { id: entry.id, bounds: { ...entry.bounds }, value: entry.value };
}

// Broad-phase index: results have intersecting bounds, then callers can test
// the exact shape with the collision helpers.
export class SpatialIndex<T> {
  private readonly entries = new Map<string, StoredEntry<T>>();
  private readonly cells = new Map<string, Set<string>>();
  private readonly oversized = new Set<string>();

  constructor(
    private readonly cellSize: number,
    private readonly maxCellsPerItem = 64,
  ) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('Cell size must be positive and finite');
    }
    if (!Number.isSafeInteger(maxCellsPerItem) || maxCellsPerItem < 1) {
      throw new RangeError('Maximum cells per item must be a positive integer');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private cellKeys(bounds: SpatialBounds, limit: number): string[] | null {
    const firstX = Math.floor(bounds.minX / this.cellSize);
    const lastX = Math.floor(bounds.maxX / this.cellSize);
    const firstY = Math.floor(bounds.minY / this.cellSize);
    const lastY = Math.floor(bounds.maxY / this.cellSize);
    // Unsafe cell coordinates may stop advancing when incremented in a loop.
    if (
      !Number.isSafeInteger(firstX) ||
      !Number.isSafeInteger(lastX) ||
      !Number.isSafeInteger(firstY) ||
      !Number.isSafeInteger(lastY)
    ) {
      return null;
    }
    const columns = lastX - firstX + 1;
    const rows = lastY - firstY + 1;
    if (columns > limit || rows > limit || columns * rows > limit) {
      return null;
    }

    const keys: string[] = [];
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        keys.push(`${x},${y}`);
      }
    }
    return keys;
  }

  upsert(id: string, bounds: SpatialBounds, value: T): void {
    if (id.length === 0)
      throw new RangeError('Spatial item ID cannot be empty');
    const boundsCopy = copyValidBounds(bounds);
    const cellKeys = this.cellKeys(boundsCopy, this.maxCellsPerItem);

    this.remove(id);
    this.entries.set(id, { id, bounds: boundsCopy, value, cellKeys });
    if (cellKeys === null) {
      this.oversized.add(id);
    } else {
      for (const key of cellKeys) {
        let cell = this.cells.get(key);
        if (cell === undefined) {
          cell = new Set<string>();
          this.cells.set(key, cell);
        }
        cell.add(id);
      }
    }
  }

  get(id: string): SpatialIndexEntry<T> | undefined {
    const entry = this.entries.get(id);
    return entry === undefined ? undefined : snapshot(entry);
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;

    if (entry.cellKeys === null) {
      this.oversized.delete(id);
    } else {
      for (const key of entry.cellKeys) {
        const cell = this.cells.get(key);
        cell?.delete(id);
        if (cell?.size === 0) this.cells.delete(key);
      }
    }
    this.entries.delete(id);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.cells.clear();
    this.oversized.clear();
  }

  search(bounds: SpatialBounds): SpatialIndexEntry<T>[] {
    const query = copyValidBounds(bounds);
    const keys = this.cellKeys(query, maxQueryCells);
    const candidates = new Set<string>(this.oversized);
    if (keys === null) {
      for (const id of this.entries.keys()) candidates.add(id);
    } else {
      for (const key of keys) {
        for (const id of this.cells.get(key) ?? []) candidates.add(id);
      }
    }

    const matches: SpatialIndexEntry<T>[] = [];
    for (const id of candidates) {
      const entry = this.entries.get(id);
      if (entry !== undefined && boundsIntersect(entry.bounds, query)) {
        matches.push(snapshot(entry));
      }
    }
    return matches;
  }

  searchPoint(point: Vector2): SpatialIndexEntry<T>[] {
    return this.search({
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    });
  }
}

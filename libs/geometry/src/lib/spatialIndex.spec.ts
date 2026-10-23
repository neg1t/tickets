import { describe, expect, it } from 'vitest';
import { SpatialIndex } from './spatialIndex.js';

describe('SpatialIndex', () => {
  it('finds only bounds intersecting a region or a point, including touching edges', () => {
    const index = new SpatialIndex<string>(10);
    index.upsert('first', { minX: 1, minY: 1, maxX: 11, maxY: 11 }, 'A');
    index.upsert('second', { minX: 11, minY: 1, maxX: 14, maxY: 4 }, 'B');
    index.upsert('third', { minX: 18, minY: 18, maxX: 19, maxY: 19 }, 'C');

    expect(index.size).toBe(3);
    expect(
      index
        .searchPoint({ x: 11, y: 2 })
        .map((item) => item.id)
        .sort(),
    ).toEqual(['first', 'second']);
    expect(
      index
        .search({ minX: 2, minY: 2, maxX: 3, maxY: 3 })
        .map((item) => item.id),
    ).toEqual(['first']);
    expect(index.search({ minX: 15, minY: 15, maxX: 16, maxY: 16 })).toEqual(
      [],
    );
    expect(index.searchPoint({ x: 11, y: 11 }).map((item) => item.id)).toEqual([
      'first',
    ]);
  });

  it('moves and replaces an item without leaving stale cells', () => {
    const index = new SpatialIndex<number>(5);
    index.upsert('seat-1', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 1);
    index.upsert('seat-1', { minX: 20, minY: -5, maxX: 22, maxY: -3 }, 2);

    expect(index.size).toBe(1);
    expect(index.searchPoint({ x: 0, y: 0 })).toEqual([]);
    expect(index.searchPoint({ x: 21, y: -4 })).toEqual([
      {
        id: 'seat-1',
        bounds: { minX: 20, minY: -5, maxX: 22, maxY: -3 },
        value: 2,
      },
    ]);
    expect(index.get('seat-1')?.value).toBe(2);
  });

  it('removes and clears indexed entries', () => {
    const index = new SpatialIndex<string>(10);
    index.upsert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 'A');
    index.upsert('b', { minX: 2, minY: 2, maxX: 3, maxY: 3 }, 'B');

    expect(index.remove('a')).toBe(true);
    expect(index.remove('a')).toBe(false);
    expect(index.get('a')).toBeUndefined();
    expect(index.searchPoint({ x: 0, y: 0 })).toEqual([]);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.search({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual([]);
  });

  it('indexes oversized objects without expanding every covered cell', () => {
    const index = new SpatialIndex<string>(10, 4);
    index.upsert(
      'hall',
      { minX: -100, minY: -100, maxX: 100, maxY: 100 },
      'large',
    );
    index.upsert('seat', { minX: 1, minY: 1, maxX: 2, maxY: 2 }, 'small');

    expect(index.searchPoint({ x: 50, y: 50 }).map((item) => item.id)).toEqual([
      'hall',
    ]);
    expect(
      index
        .searchPoint({ x: 1, y: 1 })
        .map((item) => item.id)
        .sort(),
    ).toEqual(['hall', 'seat']);
    expect(
      index
        .search({ minX: -500, minY: -500, maxX: 500, maxY: 500 })
        .map((item) => item.id)
        .sort(),
    ).toEqual(['hall', 'seat']);

    index.upsert(
      'hall',
      { minX: 200, minY: 200, maxX: 201, maxY: 201 },
      'moved',
    );
    expect(index.searchPoint({ x: 50, y: 50 })).toEqual([]);
    expect(
      index.searchPoint({ x: 200, y: 200 }).map((item) => item.id),
    ).toEqual(['hall']);
  });

  it('copies bounds so caller mutation cannot corrupt the index', () => {
    const index = new SpatialIndex<string>(10);
    const bounds = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    index.upsert('a', bounds, 'A');
    bounds.minX = 100;
    const found = index.get('a');
    if (found === undefined) throw new Error('Expected indexed entry');
    found.bounds.maxX = 100;

    expect(index.searchPoint({ x: 1, y: 1 }).map((item) => item.id)).toEqual([
      'a',
    ]);
    expect(index.get('a')?.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 2,
      maxY: 2,
    });
  });

  it('handles thousands of entries and a local query', () => {
    const index = new SpatialIndex<number>(10);
    for (let item = 0; item < 5_000; item += 1) {
      const x = (item % 100) * 10;
      const y = Math.floor(item / 100) * 10;
      index.upsert(
        String(item),
        { minX: x, minY: y, maxX: x + 1, maxY: y + 1 },
        item,
      );
    }

    expect(index.size).toBe(5_000);
    expect(
      index.searchPoint({ x: 20.5, y: 30.5 }).map((item) => item.value),
    ).toEqual([302]);
    expect(index.searchPoint({ x: -1, y: -1 })).toEqual([]);
  });

  it('handles coordinates beyond the safe integer cell range', () => {
    const index = new SpatialIndex<string>(1);
    index.upsert(
      'far',
      { minX: 1e20, minY: 1e20, maxX: 1e20, maxY: 1e20 },
      'distant',
    );

    expect(
      index.searchPoint({ x: 1e20, y: 1e20 }).map((item) => item.id),
    ).toEqual(['far']);
    expect(index.searchPoint({ x: 0, y: 0 })).toEqual([]);
  });

  it('rejects invalid bounds and keeps the old entry when an update fails', () => {
    expect(() => new SpatialIndex(0)).toThrow(RangeError);
    expect(() => new SpatialIndex(10, 0)).toThrow(RangeError);

    const index = new SpatialIndex<string>(10);
    index.upsert('a', { minX: 0, minY: 0, maxX: 1, maxY: 1 }, 'A');
    expect(() =>
      index.upsert('a', { minX: 2, minY: 0, maxX: 1, maxY: 1 }, 'B'),
    ).toThrow(RangeError);
    expect(() =>
      index.upsert('b', { minX: 0, minY: 0, maxX: Infinity, maxY: 1 }, 'B'),
    ).toThrow(RangeError);
    expect(() => index.searchPoint({ x: NaN, y: 0 })).toThrow(RangeError);
    expect(index.get('a')?.value).toBe('A');
    expect(index.searchPoint({ x: 0, y: 0 }).map((item) => item.id)).toEqual([
      'a',
    ]);
  });
});

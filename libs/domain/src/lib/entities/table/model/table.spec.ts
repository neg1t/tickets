import { describe, expect, it } from 'vitest';
import { tableSchema } from './table.js';

const baseTable = {
  id: 'table-1',
  floorId: 'floor-ground',
  label: '1',
  center: { x: 100, y: 50 },
  rotationRadians: Math.PI / 4,
};

describe('tableSchema', () => {
  it('parses a circular table and survives JSON serialization', () => {
    const table = tableSchema.parse({
      ...baseTable,
      label: ' 1 ',
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    });

    expect(tableSchema.parse(JSON.parse(JSON.stringify(table)))).toEqual({
      ...baseTable,
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    });
  });

  it('parses a rectangular table with an excluded side', () => {
    expect(
      tableSchema.parse({
        ...baseTable,
        zoneId: 'zone-banquet',
        shape: {
          kind: 'rectangle',
          width: 80,
          height: 40,
          seatsPerSide: { top: 2, right: 1, bottom: 0, left: 1 },
        },
      }).shape,
    ).toEqual({
      kind: 'rectangle',
      width: 80,
      height: 40,
      seatsPerSide: { top: 2, right: 1, bottom: 0, left: 1 },
    });
  });

  it.each([
    {
      ...baseTable,
      id: '',
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    },
    {
      ...baseTable,
      floorId: '',
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    },
    {
      ...baseTable,
      zoneId: '',
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    },
    {
      ...baseTable,
      label: '   ',
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    },
    {
      ...baseTable,
      center: { x: Infinity, y: 0 },
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    },
    {
      ...baseTable,
      rotationRadians: Infinity,
      shape: { kind: 'circle', radius: 20, seatCount: 6 },
    },
    { ...baseTable, shape: { kind: 'circle', radius: 0, seatCount: 6 } },
    { ...baseTable, shape: { kind: 'circle', radius: 20, seatCount: 2.5 } },
    {
      ...baseTable,
      shape: {
        kind: 'rectangle',
        width: -1,
        height: 40,
        seatsPerSide: { top: 2, right: 1, bottom: 0, left: 1 },
      },
    },
    {
      ...baseTable,
      shape: {
        kind: 'rectangle',
        width: 80,
        height: 40,
        seatsPerSide: { top: 2, right: -1, bottom: 0, left: 1 },
      },
    },
  ])('rejects invalid table data: %o', (table) => {
    expect(tableSchema.safeParse(table).success).toBe(false);
  });
});

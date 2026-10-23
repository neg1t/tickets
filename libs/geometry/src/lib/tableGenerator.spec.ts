import { describe, expect, it } from 'vitest';
import {
  generateTableSeatSlots,
  type TableGeometry,
} from './tableGenerator.js';

const roundTable: TableGeometry = {
  center: { x: 20, y: 20 },
  rotationRadians: 0,
  shape: { kind: 'circle', radius: 4, seatCount: 4 },
};

const rectangleTable: TableGeometry = {
  center: { x: 0, y: 0 },
  rotationRadians: 0,
  shape: {
    kind: 'rectangle',
    width: 12,
    height: 6,
    seatsPerSide: { top: 2, right: 1, bottom: 0, left: 1 },
  },
};

describe('generateTableSeatSlots', () => {
  it('places circular seats clockwise outside the rim, facing the table', () => {
    const slots = generateTableSeatSlots(roundTable, { seatOffset: 1 });

    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'circle:0',
      'circle:1',
      'circle:2',
      'circle:3',
    ]);
    expect(slots.map((slot) => slot.label)).toEqual(['1', '2', '3', '4']);
    expect(slots[0]?.position).toEqual({ x: 25, y: 20 });
    expect(slots[1]?.position.x).toBeCloseTo(20);
    expect(slots[1]?.position.y).toBeCloseTo(25);
    expect(slots[2]?.position.x).toBeCloseTo(15);
    expect(slots[2]?.position.y).toBeCloseTo(20);
    expect(slots[3]?.position.x).toBeCloseTo(20);
    expect(slots[3]?.position.y).toBeCloseTo(15);
    expect(slots[0]?.facingRadians).toBeCloseTo(Math.PI);
  });

  it('rotates and translates circular seats without changing their keys', () => {
    const rotated = generateTableSeatSlots(
      {
        ...roundTable,
        center: { x: 10, y: -5 },
        rotationRadians: Math.PI / 2,
      },
      { seatOffset: 1 },
    );

    expect(rotated.map((slot) => slot.slotKey)).toEqual(
      generateTableSeatSlots(roundTable, { seatOffset: 1 }).map(
        (slot) => slot.slotKey,
      ),
    );
    expect(rotated[0]?.position.x).toBeCloseTo(10);
    expect(rotated[0]?.position.y).toBeCloseTo(0);
    expect(rotated[0]?.facingRadians).toBeCloseTo(-Math.PI / 2);
  });

  it('omits excluded rectangle sides and numbers seats around the perimeter', () => {
    const slots = generateTableSeatSlots(rectangleTable, {
      seatOffset: 1,
      numbering: { start: 10, prefix: 'T1-', direction: 'reverse' },
    });

    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'top:0',
      'top:1',
      'right:0',
      'left:0',
    ]);
    expect(slots.map((slot) => slot.label)).toEqual([
      'T1-13',
      'T1-12',
      'T1-11',
      'T1-10',
    ]);
    expect(slots.map((slot) => slot.position)).toEqual([
      { x: -2, y: -4 },
      { x: 2, y: -4 },
      { x: 7, y: 0 },
      { x: -7, y: 0 },
    ]);
    expect(slots[0]?.facingRadians).toBeCloseTo(Math.PI / 2);
    expect(slots[2]?.facingRadians).toBeCloseTo(Math.PI);
    expect(slots[3]?.facingRadians).toBeCloseTo(0);
  });

  it('places bottom seats right to left and preserves side keys when another side changes count', () => {
    const shape = {
      kind: 'rectangle' as const,
      width: 12,
      height: 6,
      seatsPerSide: { top: 1, right: 1, bottom: 2, left: 0 },
    };
    const slots = generateTableSeatSlots(
      { ...rectangleTable, shape },
      { seatOffset: 1 },
    );

    expect(slots.map((slot) => slot.slotKey)).toEqual([
      'top:0',
      'right:0',
      'bottom:0',
      'bottom:1',
    ]);
    expect(slots[2]?.position).toEqual({ x: 2, y: 4 });
    expect(slots[3]?.position).toEqual({ x: -2, y: 4 });
    expect(slots[2]?.facingRadians).toBeCloseTo(-Math.PI / 2);

    const changed = generateTableSeatSlots(
      {
        ...rectangleTable,
        shape: {
          ...shape,
          seatsPerSide: { ...shape.seatsPerSide, top: 3 },
        },
      },
      { seatOffset: 1 },
    );
    expect(changed.find((slot) => slot.slotKey === 'right:0')?.slotKey).toBe(
      slots.find((slot) => slot.slotKey === 'right:0')?.slotKey,
    );
  });

  it('applies a manual world-space offset and facing correction to a slot', () => {
    const slots = generateTableSeatSlots(rectangleTable, {
      seatOffset: 1,
      adjustments: [
        {
          slotKey: 'right:0',
          offset: { x: 2, y: 3 },
          facingOffsetRadians: 0.25,
        },
      ],
    });

    expect(slots[2]?.position).toEqual({ x: 9, y: 3 });
    expect(slots[2]?.facingRadians).toBeCloseTo(Math.PI + 0.25);
  });

  it('returns no seats when all counts are zero', () => {
    expect(
      generateTableSeatSlots(
        {
          ...roundTable,
          shape: { kind: 'circle', radius: 4, seatCount: 0 },
        },
        { seatOffset: 1 },
      ),
    ).toEqual([]);
    expect(
      generateTableSeatSlots(
        {
          ...rectangleTable,
          shape: {
            kind: 'rectangle',
            width: 12,
            height: 6,
            seatsPerSide: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        { seatOffset: 1 },
      ),
    ).toEqual([]);
  });

  it('rejects invalid geometry, counts and seat options', () => {
    expect(() =>
      generateTableSeatSlots(roundTable, { seatOffset: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      generateTableSeatSlots(
        { ...roundTable, shape: { kind: 'circle', radius: 0, seatCount: 4 } },
        { seatOffset: 1 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      generateTableSeatSlots(
        { ...roundTable, shape: { kind: 'circle', radius: 4, seatCount: 2.5 } },
        { seatOffset: 1 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      generateTableSeatSlots(
        { ...rectangleTable, rotationRadians: Infinity },
        { seatOffset: 1 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      generateTableSeatSlots(rectangleTable, {
        seatOffset: 1,
        adjustments: [{ slotKey: 'bottom:0', offset: { x: 1, y: 0 } }],
      }),
    ).toThrow(RangeError);
  });
});

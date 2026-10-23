import { describe, expect, it } from 'vitest';
import { generateRowSeatSlots, type RowPath } from './rowGenerator.js';

const line: RowPath = {
  kind: 'line',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};

describe('generateRowSeatSlots', () => {
  it('places even seats between the insets and retains slot identity when reshaped', () => {
    const options = {
      distribution: { kind: 'even' as const, count: 4 },
      startInset: 10,
      endInset: 30,
    };

    const slots = generateRowSeatSlots(line, options);
    expect(
      slots.map(({ slotIndex, label, position }) => ({
        slotIndex,
        label,
        position,
      })),
    ).toEqual([
      { slotIndex: 0, label: '1', position: { x: 10, y: 0 } },
      { slotIndex: 1, label: '2', position: { x: 30, y: 0 } },
      { slotIndex: 2, label: '3', position: { x: 50, y: 0 } },
      { slotIndex: 3, label: '4', position: { x: 70, y: 0 } },
    ]);
    expect(slots.every((slot) => slot.rotationRadians === 0)).toBe(true);

    const reshaped = generateRowSeatSlots(
      { ...line, end: { x: 120, y: 0 } },
      options,
    );
    expect(
      reshaped.map(({ slotIndex, label }) => ({ slotIndex, label })),
    ).toEqual(slots.map(({ slotIndex, label }) => ({ slotIndex, label })));
    expect(reshaped[1]?.position.x).toBeCloseTo(10 + 80 / 3);
  });

  it('places arc seats by length and rotates them along the tangent', () => {
    const slots = generateRowSeatSlots(
      {
        kind: 'arc',
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: Math.PI / 2,
      },
      { distribution: { kind: 'even', count: 3 } },
    );

    expect(slots[0]?.position).toEqual({ x: 10, y: 0 });
    expect(slots[1]?.position.x).toBeCloseTo(Math.sqrt(50));
    expect(slots[1]?.position.y).toBeCloseTo(Math.sqrt(50));
    expect(slots[2]?.position.x).toBeCloseTo(0);
    expect(slots[2]?.position.y).toBeCloseTo(10);
    expect(slots.map(({ rotationRadians }) => rotationRadians)).toEqual([
      Math.PI / 2,
      (3 * Math.PI) / 4,
      Math.PI,
    ]);
  });

  it('uses arc length rather than the Bezier parameter', () => {
    const slots = generateRowSeatSlots(
      {
        kind: 'bezier',
        p0: { x: 0, y: 0 },
        p1: { x: 0, y: 0 },
        p2: { x: 0, y: 0 },
        p3: { x: 100, y: 0 },
      },
      { distribution: { kind: 'even', count: 3 } },
    );

    expect(slots.map((slot) => slot.position.x)).toEqual([
      0,
      expect.closeTo(50, 1),
      100,
    ]);
    expect(slots[1]?.rotationRadians).toBe(0);
  });

  it('continues through polyline corners and uses the next segment tangent', () => {
    const slots = generateRowSeatSlots(
      {
        kind: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      { distribution: { kind: 'even', count: 5 } },
    );

    expect(slots.map((slot) => slot.position)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(slots[2]?.rotationRadians).toBe(Math.PI / 2);
  });

  it('combines fixed spacing, an aisle gap, omitted slots, reverse numbering and an adjustment', () => {
    const slots = generateRowSeatSlots(line, {
      distribution: { kind: 'fixed', count: 5, step: 15 },
      gaps: [{ afterSlot: 1, length: 20 }],
      skippedSlots: [2],
      numbering: {
        start: 10,
        direction: 'reverse',
        skippedNumbers: [11],
      },
      adjustments: [
        {
          slotIndex: 3,
          offset: { x: 1, y: 2 },
          rotationOffsetRadians: 0.25,
        },
      ],
    });

    expect(slots.map((slot) => slot.slotIndex)).toEqual([0, 1, 3, 4]);
    expect(slots.map((slot) => slot.label)).toEqual(['14', '13', '12', '10']);
    expect(slots.map((slot) => slot.distanceAlongRow)).toEqual([0, 15, 65, 80]);
    expect(slots[2]?.position).toEqual({ x: 66, y: 2 });
    expect(slots[2]?.rotationRadians).toBe(0.25);
  });

  it('centers a single seat and permits an empty row', () => {
    expect(
      generateRowSeatSlots(line, {
        distribution: { kind: 'even', count: 1 },
        startInset: 10,
        endInset: 20,
      })[0]?.position,
    ).toEqual({ x: 45, y: 0 });
    expect(
      generateRowSeatSlots(line, {
        distribution: { kind: 'even', count: 0 },
      }),
    ).toEqual([]);
  });

  it('rejects invalid placement options and a path without length', () => {
    expect(() =>
      generateRowSeatSlots(line, { distribution: { kind: 'even', count: -1 } }),
    ).toThrow(RangeError);
    expect(() =>
      generateRowSeatSlots(line, {
        distribution: { kind: 'fixed', count: 2, step: 0 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateRowSeatSlots(line, {
        distribution: { kind: 'even', count: 2 },
        startInset: 60,
        endInset: 50,
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateRowSeatSlots(line, {
        distribution: { kind: 'fixed', count: 3, step: 60 },
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateRowSeatSlots(line, {
        distribution: { kind: 'even', count: 2 },
        gaps: [{ afterSlot: 1, length: 10 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateRowSeatSlots(line, {
        distribution: { kind: 'even', count: 2 },
        skippedSlots: [2],
      }),
    ).toThrow(RangeError);
    expect(() =>
      generateRowSeatSlots(
        { ...line, end: { x: 0, y: 0 } },
        { distribution: { kind: 'even', count: 2 } },
      ),
    ).toThrow(RangeError);
  });
});

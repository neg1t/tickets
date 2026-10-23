import { describe, expect, it } from 'vitest';
import { rowSchema } from './row.js';

const baseRow = {
  id: 'row-a',
  floorId: 'floor-ground',
  name: 'A',
};

describe('rowSchema', () => {
  it('parses a row on a floor without a zone and survives JSON serialization', () => {
    const row = rowSchema.parse({
      ...baseRow,
      name: ' A ',
      curve: {
        kind: 'line',
        start: { x: 0, y: 10 },
        end: { x: 100, y: 10 },
      },
    });

    expect(rowSchema.parse(JSON.parse(JSON.stringify(row)))).toEqual({
      ...baseRow,
      curve: {
        kind: 'line',
        start: { x: 0, y: 10 },
        end: { x: 100, y: 10 },
      },
    });
  });

  it.each([
    {
      kind: 'arc',
      center: { x: 50, y: 50 },
      radius: 30,
      startAngle: 0,
      endAngle: Math.PI,
    },
    {
      kind: 'bezier',
      p0: { x: 0, y: 0 },
      p1: { x: 20, y: 30 },
      p2: { x: 80, y: 30 },
      p3: { x: 100, y: 0 },
    },
    {
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 20 },
        { x: 100, y: 0 },
      ],
    },
  ])('parses a row in a zone with a $kind curve', (curve) => {
    expect(
      rowSchema.parse({ ...baseRow, zoneId: 'zone-stalls', curve }).zoneId,
    ).toBe('zone-stalls');
  });

  it.each([
    {
      ...baseRow,
      id: '',
      curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    },
    {
      ...baseRow,
      floorId: '',
      curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    },
    {
      ...baseRow,
      zoneId: '',
      curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    },
    {
      ...baseRow,
      name: '   ',
      curve: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    },
    {
      ...baseRow,
      curve: {
        kind: 'line',
        start: { x: Infinity, y: 0 },
        end: { x: 1, y: 0 },
      },
    },
    {
      ...baseRow,
      curve: {
        kind: 'arc',
        center: { x: 0, y: 0 },
        radius: 0,
        startAngle: 0,
        endAngle: 1,
      },
    },
    { ...baseRow, curve: { kind: 'polyline', points: [{ x: 0, y: 0 }] } },
  ])('rejects invalid row data: %o', (row) => {
    expect(rowSchema.safeParse(row).success).toBe(false);
  });
});

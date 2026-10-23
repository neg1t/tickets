import { describe, expect, it } from 'vitest';
import { zoneSchema } from './zone.js';

describe('zoneSchema', () => {
  it('requires capacity for a general admission zone', () => {
    expect(
      zoneSchema.safeParse({
        id: 'zone-ga',
        floorId: 'floor-ground',
        name: 'Standing',
        kind: 'ga',
      }).success,
    ).toBe(false);
    expect(
      zoneSchema.safeParse({
        id: 'zone-ga',
        floorId: 'floor-ground',
        name: 'Standing',
        kind: 'ga',
        capacity: 20,
      }).success,
    ).toBe(true);
  });
  it('parses a zone linked to a floor', () => {
    expect(
      zoneSchema.parse({
        id: 'zone-stalls',
        floorId: 'floor-ground',
        name: 'Stalls',
      }),
    ).toEqual({
      id: 'zone-stalls',
      floorId: 'floor-ground',
      kind: 'seated',
      name: 'Stalls',
    });
  });

  it.each([
    { id: '', floorId: 'floor-ground', name: 'Stalls' },
    { id: 'zone-stalls', floorId: '', name: 'Stalls' },
    { id: 'zone-stalls', floorId: 'floor-ground', name: '   ' },
  ])('rejects incomplete zone data: %o', (zone) => {
    expect(zoneSchema.safeParse(zone).success).toBe(false);
  });

  it('trims the zone name and survives JSON serialization', () => {
    const zone = zoneSchema.parse({
      id: 'zone-stalls',
      floorId: 'floor-ground',
      name: ' Stalls ',
    });

    expect(zoneSchema.parse(JSON.parse(JSON.stringify(zone)))).toEqual({
      id: 'zone-stalls',
      floorId: 'floor-ground',
      kind: 'seated',
      name: 'Stalls',
    });
  });
});

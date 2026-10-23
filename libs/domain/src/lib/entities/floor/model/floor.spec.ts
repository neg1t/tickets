import { describe, expect, it } from 'vitest';
import { floorSchema } from './floor.js';

describe('floorSchema', () => {
  it('parses a floor linked to a specific layout version', () => {
    expect(
      floorSchema.parse({
        id: 'floor-ground',
        layoutVersionId: 'layout-version-1',
        name: 'Ground floor',
      }),
    ).toEqual({
      id: 'floor-ground',
      layoutVersionId: 'layout-version-1',
      name: 'Ground floor',
    });
  });

  it.each([
    { id: '', layoutVersionId: 'layout-version-1', name: 'Ground floor' },
    { id: 'floor-ground', layoutVersionId: '', name: 'Ground floor' },
    { id: 'floor-ground', layoutVersionId: 'layout-version-1', name: '   ' },
  ])('rejects incomplete floor data: %o', (floor) => {
    expect(floorSchema.safeParse(floor).success).toBe(false);
  });

  it('trims the floor name and survives JSON serialization', () => {
    const floor = floorSchema.parse({
      id: 'floor-ground',
      layoutVersionId: 'layout-version-1',
      name: ' Ground floor ',
    });

    expect(floorSchema.parse(JSON.parse(JSON.stringify(floor)))).toEqual({
      id: 'floor-ground',
      layoutVersionId: 'layout-version-1',
      name: 'Ground floor',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { layoutSchema } from './layout.js';

describe('layoutSchema', () => {
  it('parses a logical layout linked to a hall', () => {
    expect(
      layoutSchema.parse({
        id: 'layout-main',
        hallId: 'hall-main',
        name: 'Main seating layout',
      }),
    ).toEqual({
      id: 'layout-main',
      hallId: 'hall-main',
      name: 'Main seating layout',
    });
  });

  it.each([
    { id: '', hallId: 'hall-main', name: 'Main seating layout' },
    { id: 'layout-main', hallId: '', name: 'Main seating layout' },
    { id: 'layout-main', hallId: 'hall-main', name: '   ' },
  ])('rejects incomplete layout data: %o', (layout) => {
    expect(layoutSchema.safeParse(layout).success).toBe(false);
  });

  it('trims whitespace around a layout name', () => {
    expect(
      layoutSchema.parse({
        id: 'layout-main',
        hallId: 'hall-main',
        name: ' Main seating layout ',
      }).name,
    ).toBe('Main seating layout');
  });
});

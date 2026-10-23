import { describe, expect, it } from 'vitest';
import { hallSchema } from './hall.js';

describe('hallSchema', () => {
  it('parses a hall with a stable ID, venue ID, and name', () => {
    expect(
      hallSchema.parse({
        id: 'hall-main',
        venueId: 'venue-city',
        name: 'Main Hall',
      }),
    ).toEqual({
      id: 'hall-main',
      venueId: 'venue-city',
      name: 'Main Hall',
    });
  });

  it.each([
    { id: '', venueId: 'venue-city', name: 'Main Hall' },
    { id: 'hall-main', venueId: '', name: 'Main Hall' },
    { id: 'hall-main', venueId: 'venue-city', name: '   ' },
  ])('rejects incomplete hall data: %o', (hall) => {
    expect(hallSchema.safeParse(hall).success).toBe(false);
  });

  it('trims whitespace around a hall name', () => {
    expect(
      hallSchema.parse({
        id: 'hall-main',
        venueId: 'venue-city',
        name: ' Main Hall ',
      }).name,
    ).toBe('Main Hall');
  });
});

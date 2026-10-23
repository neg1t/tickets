import { describe, expect, it } from 'vitest';
import { occurrenceSchema } from './occurrence.js';

const occurrence = {
  id: 'occurrence-1',
  eventId: 'event-1',
  layoutVersionId: 'layout-version-1',
  startsAt: '2026-11-05T19:30:00+07:00',
};

describe('occurrenceSchema', () => {
  it('parses an occurrence linked to a layout version and survives JSON serialization', () => {
    const parsed = occurrenceSchema.parse(occurrence);

    expect(occurrenceSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(
      occurrence,
    );
  });

  it('accepts a UTC start time', () => {
    expect(
      occurrenceSchema.parse({
        ...occurrence,
        startsAt: '2026-11-05T12:30:00Z',
      }).startsAt,
    ).toBe('2026-11-05T12:30:00Z');
  });

  it.each([
    { ...occurrence, id: '' },
    { ...occurrence, eventId: '' },
    { ...occurrence, layoutVersionId: '' },
    { ...occurrence, startsAt: '2026-11-05T19:30:00' },
    { ...occurrence, startsAt: '2026-11-05' },
    { ...occurrence, startsAt: 'not-a-date' },
  ])('rejects invalid occurrence data: %o', (input) => {
    expect(occurrenceSchema.safeParse(input).success).toBe(false);
  });
});

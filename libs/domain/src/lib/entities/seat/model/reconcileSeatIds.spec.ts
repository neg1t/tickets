import { describe, expect, it } from 'vitest';
import { seatIdSchema } from '../../../shared/ids/index.js';
import { reconcileSeatIds } from './reconcileSeatIds.js';

const seatA = seatIdSchema.parse('seat-a');
const seatB = seatIdSchema.parse('seat-b');
const seatC = seatIdSchema.parse('seat-c');

describe('reconcileSeatIds', () => {
  it('preserves IDs when row geometry changes or slots are reordered', () => {
    expect(
      reconcileSeatIds({
        previousSeatIds: [seatA, seatB],
        nextSeatIds: [seatB, seatA],
        reservedSeatIds: [],
        publishedSeatIds: [seatA, seatB],
        createSeatId: () => {
          throw new Error('No new ID should be created');
        },
      }),
    ).toEqual({
      seatIds: [seatB, seatA],
      createdSeatIds: [],
      removedSeatIds: [],
      removedPublishedSeatIds: [],
    });
  });

  it('creates IDs only for new slots', () => {
    expect(
      reconcileSeatIds({
        previousSeatIds: [seatA, seatB],
        nextSeatIds: [seatA, null, seatB],
        reservedSeatIds: [],
        publishedSeatIds: [seatA],
        createSeatId: () => seatC,
      }),
    ).toEqual({
      seatIds: [seatA, seatC, seatB],
      createdSeatIds: [seatC],
      removedSeatIds: [],
      removedPublishedSeatIds: [],
    });
  });

  it('reports removed IDs and which removals affect published layouts', () => {
    expect(
      reconcileSeatIds({
        previousSeatIds: [seatA, seatB, seatC],
        nextSeatIds: [seatA],
        reservedSeatIds: [],
        publishedSeatIds: [seatB],
      }),
    ).toEqual({
      seatIds: [seatA],
      createdSeatIds: [],
      removedSeatIds: [seatB, seatC],
      removedPublishedSeatIds: [seatB],
    });
  });

  it('generates a new valid ID by default', () => {
    const result = reconcileSeatIds({
      previousSeatIds: [],
      nextSeatIds: [null],
      reservedSeatIds: [],
      publishedSeatIds: [],
    });

    expect(result.createdSeatIds).toHaveLength(1);
    expect(seatIdSchema.safeParse(result.createdSeatIds[0]).success).toBe(true);
    expect(result.seatIds).toEqual(result.createdSeatIds);
  });

  it.each([
    {
      previousSeatIds: [seatA, seatA],
      nextSeatIds: [seatA],
      reservedSeatIds: [],
      publishedSeatIds: [],
    },
    {
      previousSeatIds: [seatA],
      nextSeatIds: [seatA, seatA],
      reservedSeatIds: [],
      publishedSeatIds: [],
    },
    {
      previousSeatIds: [seatA],
      nextSeatIds: [seatB],
      reservedSeatIds: [],
      publishedSeatIds: [],
    },
  ])('rejects duplicate or unknown retained IDs: %o', (input) => {
    expect(() => reconcileSeatIds(input)).toThrow();
  });

  it('rejects generated IDs that collide with existing or published IDs', () => {
    expect(() =>
      reconcileSeatIds({
        previousSeatIds: [seatA],
        nextSeatIds: [seatA, null],
        reservedSeatIds: [],
        publishedSeatIds: [seatB],
        createSeatId: () => seatB,
      }),
    ).toThrow();
  });

  it('rejects a generated ID used by another seat in the draft', () => {
    expect(() =>
      reconcileSeatIds({
        previousSeatIds: [seatA],
        nextSeatIds: [seatA, null],
        reservedSeatIds: [seatC],
        publishedSeatIds: [],
        createSeatId: () => seatC,
      }),
    ).toThrow();
  });
});

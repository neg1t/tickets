import { readFileSync } from 'node:fs';
import {
  assertPublishedVersionForOccurrence,
  inventorySchema,
  layoutDocumentSchema,
  occurrenceSchema,
} from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';

const fixtureNames = [
  'small-theater',
  'opera-hall',
  'arena',
  'banquet-hall',
] as const;

function loadFixture(name: (typeof fixtureNames)[number]) {
  const json = readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(json) as {
    document: unknown;
    occurrence: unknown;
    inventory: unknown;
  };
}

describe('synthetic hall fixtures', () => {
  it.each(fixtureNames)(
    '%s has valid linked geometry and sales data',
    (name) => {
      const fixture = loadFixture(name);
      const document = layoutDocumentSchema.parse(fixture.document);
      const occurrence = occurrenceSchema.parse(fixture.occurrence);
      const inventory = inventorySchema.parse(fixture.inventory);

      expect(
        assertPublishedVersionForOccurrence(
          occurrence.layoutVersionId,
          document.version,
        ),
      ).toBe(document.version);
      expect(inventory.occurrenceId).toBe(occurrence.id);
      expect(inventory.seats.map(({ seatId }) => seatId).sort()).toEqual(
        document.snapshot.seats.map(({ id }) => id).sort(),
      );
      const zoneIds = new Set(document.snapshot.zones.map(({ id }) => id));
      expect(inventory.zones.every(({ zoneId }) => zoneIds.has(zoneId))).toBe(
        true,
      );
      expect(
        layoutDocumentSchema.parse(JSON.parse(JSON.stringify(document))),
      ).toEqual(document);
    },
  );

  it('small theater has two sectors and straight rows', () => {
    const { snapshot } = layoutDocumentSchema.parse(
      loadFixture('small-theater').document,
    );
    expect(snapshot.zones.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.rows.every(({ curve }) => curve.kind === 'line')).toBe(
      true,
    );
    expect(snapshot.seats.length).toBeGreaterThanOrEqual(16);
  });

  it('opera hall has multiple levels, curved rows, and a box', () => {
    const { snapshot } = layoutDocumentSchema.parse(
      loadFixture('opera-hall').document,
    );
    expect(snapshot.floors.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.rows.some(({ curve }) => curve.kind === 'arc')).toBe(true);
    expect(snapshot.zones.some(({ name }) => name.includes('Box'))).toBe(true);
  });

  it('arena has many sectors and seats', () => {
    const { snapshot } = layoutDocumentSchema.parse(
      loadFixture('arena').document,
    );
    expect(snapshot.zones.length).toBeGreaterThanOrEqual(8);
    expect(snapshot.seats.length).toBeGreaterThanOrEqual(64);
  });

  it('banquet hall has round and rectangular tables plus standalone seating', () => {
    const { snapshot } = layoutDocumentSchema.parse(
      loadFixture('banquet-hall').document,
    );
    expect(snapshot.tables.some(({ shape }) => shape.kind === 'circle')).toBe(
      true,
    );
    expect(
      snapshot.tables.some(({ shape }) => shape.kind === 'rectangle'),
    ).toBe(true);
    expect(
      snapshot.seats.some(({ placement }) => placement.kind === 'table'),
    ).toBe(true);
    expect(
      snapshot.seats.some(({ placement }) => placement.kind === 'standalone'),
    ).toBe(true);
  });
});

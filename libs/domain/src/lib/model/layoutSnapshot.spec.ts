import { describe, expect, it } from 'vitest';
import {
  layoutDocumentSchema,
  layoutSnapshotSchema,
} from './layoutSnapshot.js';

const snapshot = {
  id: 'snapshot-main',
  layoutVersionId: 'version-main',
  floors: [{ id: 'floor-main', layoutVersionId: 'version-main', name: 'Main' }],
  zones: [{ id: 'zone-main', floorId: 'floor-main', name: 'Stalls' }],
  rows: [
    {
      id: 'row-main',
      floorId: 'floor-main',
      zoneId: 'zone-main',
      name: 'A',
      curve: {
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      },
    },
  ],
  seats: [
    {
      id: 'seat-row',
      floorId: 'floor-main',
      zoneId: 'zone-main',
      label: 'A1',
      position: { x: 1, y: 0 },
      placement: { kind: 'row', rowId: 'row-main' },
    },
    {
      id: 'seat-table',
      floorId: 'floor-main',
      zoneId: 'zone-main',
      label: 'T1',
      position: { x: 5, y: 5 },
      placement: { kind: 'table', tableId: 'table-main' },
    },
  ],
  tables: [
    {
      id: 'table-main',
      floorId: 'floor-main',
      zoneId: 'zone-main',
      label: 'T',
      center: { x: 5, y: 5 },
      rotationRadians: 0,
      shape: { kind: 'circle', radius: 2, seatCount: 1 },
    },
  ],
  backgrounds: [
    {
      id: 'background-main',
      floorId: 'floor-main',
      order: 0,
      position: { x: 0, y: 0 },
      scale: 1,
      rotationRadians: 0,
      opacity: 1,
      visible: true,
      locked: false,
      source: { kind: 'pdf', assetId: 'plan-main', pageNumber: 1 },
    },
  ],
};

const document = {
  hall: { id: 'hall-main', venueId: 'venue-main', name: 'Main Hall' },
  layout: { id: 'layout-main', hallId: 'hall-main', name: 'Default' },
  version: {
    id: 'version-main',
    layoutId: 'layout-main',
    versionNumber: 1,
    revision: 0,
    status: 'draft',
    snapshotId: 'snapshot-main',
    calibration: null,
    publishedAt: null,
  },
  snapshot,
};

describe('layout snapshot schema', () => {
  it('parses and serializes a complete valid layout snapshot', () => {
    const parsed = layoutSnapshotSchema.parse(snapshot);
    expect(
      layoutSnapshotSchema.parse(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(parsed);
  });

  it('rejects duplicate entity IDs', () => {
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        seats: [...snapshot.seats, snapshot.seats[0]],
      }).success,
    ).toBe(false);
  });

  it('rejects a floor owned by another version', () => {
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        floors: [{ ...snapshot.floors[0], layoutVersionId: 'version-other' }],
      }).success,
    ).toBe(false);
  });

  it('rejects missing parents and cross-floor zone links', () => {
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        zones: [{ ...snapshot.zones[0], floorId: 'floor-missing' }],
      }).success,
    ).toBe(false);
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        floors: [
          ...snapshot.floors,
          { id: 'floor-other', layoutVersionId: 'version-main', name: 'Other' },
        ],
        rows: [{ ...snapshot.rows[0], floorId: 'floor-other' }],
      }).success,
    ).toBe(false);
  });

  it('rejects seats linked to missing or cross-floor rows and tables', () => {
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        rows: [],
      }).success,
    ).toBe(false);
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        tables: [],
      }).success,
    ).toBe(false);
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        floors: [
          ...snapshot.floors,
          { id: 'floor-other', layoutVersionId: 'version-main', name: 'Other' },
        ],
        tables: [
          { ...snapshot.tables[0], floorId: 'floor-other', zoneId: undefined },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects wrong background floors and invalid nested geometry', () => {
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        backgrounds: [{ ...snapshot.backgrounds[0], floorId: 'floor-missing' }],
      }).success,
    ).toBe(false);
    expect(
      layoutSnapshotSchema.safeParse({
        ...snapshot,
        tables: [
          {
            ...snapshot.tables[0],
            shape: { kind: 'circle', radius: -2, seatCount: 1 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a GA polygon and rejects decorations on missing floors', () => {
    const valid = layoutSnapshotSchema.parse({
      ...snapshot,
      zones: [
        {
          ...snapshot.zones[0],
          kind: 'ga',
          capacity: 20,
          polygon: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
          ],
        },
      ],
      decorations: [
        {
          id: 'stage-main',
          floorId: 'floor-main',
          kind: 'stage',
          polygon: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 2 },
          ],
        },
      ],
    });
    expect(valid.zones[0]?.kind).toBe('ga');
    expect(valid.decorations).toHaveLength(1);
    expect(
      layoutSnapshotSchema.safeParse({
        ...valid,
        decorations: [{ ...valid.decorations[0], floorId: 'missing' }],
      }).success,
    ).toBe(false);
  });
});

describe('layout document schema', () => {
  it('parses and serializes a linked hall, layout, version, and snapshot', () => {
    const parsed = layoutDocumentSchema.parse(document);
    expect(
      layoutDocumentSchema.parse(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(parsed);
  });

  it.each([
    { ...document, layout: { ...document.layout, hallId: 'hall-other' } },
    { ...document, version: { ...document.version, layoutId: 'layout-other' } },
    {
      ...document,
      version: { ...document.version, snapshotId: 'snapshot-other' },
    },
    {
      ...document,
      snapshot: { ...document.snapshot, layoutVersionId: 'version-other' },
    },
  ])('rejects a broken document link: %o', (input) => {
    expect(layoutDocumentSchema.safeParse(input).success).toBe(false);
  });
});

import {
  layoutDocumentSchema,
  layoutSnapshotSchema,
} from '@hall-platform/domain';
import { describe, expect, it } from 'vitest';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import banquetHall from '@hall-platform/fixtures/banquet-hall.json' with { type: 'json' };
import operaHall from '@hall-platform/fixtures/opera-hall.json' with { type: 'json' };

import { buildHallScene, hitTestHallScene, visibleHallScene } from './hallScene.js';

describe('hall scene', () => {
  it('finds scene objects by ID without changing hit priority', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const scene = buildHallScene(snapshot, snapshot.floors[0]?.id ?? '');
    const seat = scene.seats[0];
    const row = scene.rows[0];
    if (!seat || !row) throw new Error('Fixture is missing geometry');
    expect(scene.seatsById.get(seat.id)).toBe(seat);
    expect(scene.rowsById.get(row.row.id)).toBe(row);
    expect(hitTestHallScene(scene, seat.position)).toEqual({ kind: 'seat', id: seat.id });
  });

  it('culls drawing objects while retaining source order and full hit testing', () => {
    const base = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const first = base.seats[0];
    if (!first) throw new Error('Fixture is missing a seat');
    const snapshot = {
      ...base,
      rows: [],
      tables: [],
      zones: [],
      decorations: [],
      seats: [
        { ...first, id: 'left' as typeof first.id, position: { x: 0, y: 0 } as typeof first.position },
        { ...first, id: 'far' as typeof first.id, position: { x: 100, y: 0 } as typeof first.position },
        { ...first, id: 'right' as typeof first.id, position: { x: 2, y: 0 } as typeof first.position },
      ],
    };
    const scene = buildHallScene(snapshot, first.floorId);
    const visible = visibleHallScene(scene, { minX: -1, minY: -1, maxX: 3, maxY: 1 });
    expect(visible.seats.map((seat) => seat.id)).toEqual(['left', 'right']);
    expect(hitTestHallScene(scene, { x: 100, y: 0 })).toEqual({ kind: 'seat', id: 'far' });
    const dragged = visibleHallScene(
      scene,
      { minX: -1, minY: -1, maxX: 3, maxY: 1 },
      new Set(['seat:far']),
      { x: -99, y: 0 },
    );
    expect(dragged.seats.map((seat) => seat.id)).toEqual(['left', 'far', 'right']);
  });

  it('chooses the nearest seat when expanded touch targets overlap', () => {
    const base = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const first = base.seats[0];
    if (!first) throw new Error('Missing seat');
    const scene = buildHallScene(
      {
        ...base,
        rows: [],
        tables: [],
        zones: [],
        decorations: [],
        seats: [
          {
            ...first,
            id: 'first' as typeof first.id,
            position: { x: 0, y: 0 } as typeof first.position,
          },
          {
            ...first,
            id: 'second' as typeof first.id,
            position: { x: 1, y: 0 } as typeof first.position,
          },
        ],
      },
      first.floorId,
    );
    expect(hitTestHallScene(scene, { x: 0.7, y: 0 }, 0.4)).toEqual({
      kind: 'seat',
      id: 'second',
    });
  });
  it('hits polygon zones and decorations by their actual shapes', () => {
    const base = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const floorId = base.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const snapshot = layoutSnapshotSchema.parse({
      ...base,
      rows: [],
      seats: [],
      tables: [],
      backgrounds: [],
      zones: [
        {
          id: 'zone-triangle',
          floorId,
          name: 'GA',
          kind: 'ga',
          capacity: 20,
          polygon: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 0, y: 6 },
          ],
        },
      ],
      decorations: [
        {
          id: 'decoration-stage',
          floorId,
          kind: 'stage',
          label: 'Сцена',
          polygon: [
            { x: 8, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 4 },
            { x: 8, y: 4 },
          ],
        },
      ],
    });
    const scene = buildHallScene(snapshot, floorId);
    expect(hitTestHallScene(scene, { x: 1, y: 1 })).toEqual({
      kind: 'zone',
      id: 'zone-triangle',
    });
    expect(hitTestHallScene(scene, { x: 5, y: 5 })).toBeNull();
    expect(hitTestHallScene(scene, { x: 10, y: 2 })).toEqual({
      kind: 'decoration',
      id: 'decoration-stage',
    });
  });
  it('shows standalone general admission sections without seats or drawn bounds', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const emptySections = {
      ...snapshot,
      rows: [],
      seats: [],
      tables: [],
    };
    const scene = buildHallScene(emptySections, snapshot.floors[0]?.id ?? '');

    expect(scene.zones).toHaveLength(snapshot.zones.length);
    expect(scene.zones[0]?.bounds).not.toEqual(scene.zones[1]?.bounds);
    const first = scene.zones[0];
    if (!first) throw new Error('First section is missing');
    expect(
      hitTestHallScene(scene, {
        x: (first.bounds.minX + first.bounds.maxX) / 2,
        y: (first.bounds.minY + first.bounds.maxY) / 2,
      }),
    ).toEqual({ kind: 'zone', id: first.zone.id });
  });
  it('places a rotated PDF page in world bounds without changing seat coordinates', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const floorId = snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const withBackground = {
      ...snapshot,
      backgrounds: [
        {
          id: 'plan',
          floorId,
          order: 0,
          position: { x: 10, y: 20 },
          scale: 0.5,
          rotationRadians: Math.PI / 2,
          opacity: 0.8,
          visible: true,
          locked: false,
          source: {
            kind: 'pdf' as const,
            assetId: 'asset-plan',
            pageNumber: 1,
          },
        },
      ],
    };
    const scene = buildHallScene(
      withBackground as never,
      floorId,
      {},
      {
        'asset-plan:1': { width: 100, height: 200 },
      },
    );
    expect(scene.backgrounds[0]?.bounds.minX).toBeCloseTo(-90);
    expect(scene.backgrounds[0]?.bounds.maxY).toBeCloseTo(70);
    expect(scene.seats[0]?.position).toEqual(snapshot.seats[0]?.position);
  });

  it('renders fixture geometry and finds seats before their row or zone', () => {
    const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;
    const scene = buildHallScene(snapshot, snapshot.floors[0]?.id ?? '');

    expect(scene.seats).toHaveLength(snapshot.seats.length);
    expect(scene.rows).toHaveLength(snapshot.rows.length);
    expect(scene.zones).toHaveLength(3);
    expect(hitTestHallScene(scene, { x: 0, y: 10 })).toEqual({
      kind: 'seat',
      id: 'small-theater-seat-left-1-1',
    });
    expect(
      hitTestHallScene(scene, { x: 0, y: 10 }, 0, new Set(['zone'])),
    ).toEqual({
      kind: 'zone',
      id: 'small-theater-zone-left',
    });
    expect(hitTestHallScene(scene, { x: 1, y: 10 })).toEqual({
      kind: 'row',
      id: 'small-theater-row-left-1',
    });
    expect(hitTestHallScene(scene, { x: 3, y: 12.5 })).toEqual({
      kind: 'zone',
      id: 'small-theater-zone-left',
    });
    expect(hitTestHallScene(scene, { x: -50, y: -50 })).toBeNull();
  });

  it('finds a table inside the banquet fixture', () => {
    const snapshot = layoutDocumentSchema.parse(banquetHall.document).snapshot;
    const scene = buildHallScene(snapshot, snapshot.floors[0]?.id ?? '');

    expect(scene.tables.length).toBeGreaterThan(0);
    expect(
      hitTestHallScene(scene, scene.tables[0]?.center ?? { x: 0, y: 0 }),
    ).toEqual({
      kind: 'table',
      id: scene.tables[0]?.id,
    });
  });

  it('keeps floors separate and samples curved rows', () => {
    const snapshot = layoutDocumentSchema.parse(operaHall.document).snapshot;
    const stalls = buildHallScene(snapshot, 'opera-hall-floor-stalls');
    const upper = buildHallScene(snapshot, 'opera-hall-floor-upper');

    expect(stalls.rows.every(({ row }) => row.curve.kind === 'arc')).toBe(true);
    expect(upper.rows.some(({ row }) => row.curve.kind === 'bezier')).toBe(
      true,
    );
    expect(stalls.rows[0]?.points.length).toBeGreaterThan(2);
    expect(upper.rows[0]?.points.length).toBeGreaterThan(2);
    expect(stalls.seats.every((seat) => seat.floorId === stalls.floorId)).toBe(
      true,
    );
    expect(upper.seats.every((seat) => seat.floorId === upper.floorId)).toBe(
      true,
    );
  });
});

import type {
  Background,
  Decoration,
  LayoutSnapshot,
  Row,
  Table,
  Zone,
} from '@hall-platform/domain';
import {
  createRendererScene,
  hitTestScene,
  sceneItemKey,
  type RendererScene,
  type SceneItem,
} from '@hall-platform/renderer-core';
import {
  arcPointAtFraction,
  bezierPointAtParameter,
  distanceBetweenVectors,
  distanceToSegment,
  isPointInPolygon,
  type SpatialBounds,
  type Vector2,
} from '@hall-platform/geometry';
import { hitSeatSymbol, seatSymbolBounds } from './furniture.js';

export type HallTarget = Readonly<{
  kind: 'seat' | 'row' | 'table' | 'zone' | 'decoration';
  id: string;
}>;

let sceneBuildSequence = 0;

export type SceneRow = Readonly<{
  row: Row;
  points: readonly Vector2[];
  bounds: SpatialBounds;
}>;
export type SceneZone = Readonly<{ zone: Zone; bounds: SpatialBounds }>;
export type BackgroundPageSize = Readonly<{ width: number; height: number }>;
export type SceneBackground = Readonly<{
  background: Background;
  pageKey: string;
  width: number;
  height: number;
  bounds: SpatialBounds;
}>;
export type HallScene = Readonly<{
  floorId: string;
  seats: readonly LayoutSnapshot['seats'][number][];
  rows: readonly SceneRow[];
  tables: readonly Table[];
  zones: readonly SceneZone[];
  decorations: readonly Decoration[];
  backgrounds: readonly SceneBackground[];
  seatsById: ReadonlyMap<string, LayoutSnapshot['seats'][number]>;
  rowsById: ReadonlyMap<string, SceneRow>;
  tablesById: ReadonlyMap<string, Table>;
  zonesById: ReadonlyMap<string, SceneZone>;
  decorationsById: ReadonlyMap<string, Decoration>;
  targetOrderById: ReadonlyMap<string, number>;
  bounds: SpatialBounds;
  index: RendererScene<HallTarget>;
}>;

export type VisibleHallScene = Pick<
  HallScene,
  'seats' | 'rows' | 'tables' | 'zones' | 'decorations' | 'backgrounds'
>;

const rowTolerance = 0.45;
const zonePadding = 2;

function pointBounds(point: Vector2, radius = 0): SpatialBounds {
  return {
    minX: point.x - radius,
    minY: point.y - radius,
    maxX: point.x + radius,
    maxY: point.y + radius,
  };
}

function boundsOfPoints(points: readonly Vector2[]): SpatialBounds {
  const first = points[0];
  if (!first) return pointBounds({ x: 0, y: 0 });
  return points.slice(1).reduce<SpatialBounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    pointBounds(first),
  );
}

function mergeBounds(
  first: SpatialBounds,
  second: SpatialBounds,
): SpatialBounds {
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

function expandBounds(bounds: SpatialBounds, amount: number): SpatialBounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

function rowPoints(row: Row): Vector2[] {
  const curve = row.curve;
  switch (curve.kind) {
    case 'line':
      return [curve.start, curve.end];
    case 'polyline':
      return curve.points;
    case 'arc':
      return Array.from({ length: 49 }, (_, index) =>
        arcPointAtFraction(curve, index / 48),
      );
    case 'bezier':
      return Array.from({ length: 49 }, (_, index) =>
        bezierPointAtParameter(curve, index / 48),
      );
  }
}

function tableBounds(table: Table): SpatialBounds {
  if (table.shape.kind === 'circle')
    return pointBounds(table.center, table.shape.radius);
  const halfWidth = table.shape.width / 2;
  const halfHeight = table.shape.height / 2;
  const cosine = Math.cos(table.rotationRadians);
  const sine = Math.sin(table.rotationRadians);
  return boundsOfPoints(
    [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ].map(([x, y]) => ({
      x: table.center.x + (x ?? 0) * cosine - (y ?? 0) * sine,
      y: table.center.y + (x ?? 0) * sine + (y ?? 0) * cosine,
    })),
  );
}

function backgroundBounds(
  background: Background,
  size: BackgroundPageSize,
): SpatialBounds {
  const width = size.width * background.scale;
  const height = size.height * background.scale;
  const cosine = Math.cos(background.rotationRadians);
  const sine = Math.sin(background.rotationRadians);
  return boundsOfPoints(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ].map(([x = 0, y = 0]) => ({
      x: background.position.x + x * cosine - y * sine,
      y: background.position.y + x * sine + y * cosine,
    })),
  );
}

export function buildHallScene(
  snapshot: LayoutSnapshot,
  floorId: string,
  explicitZoneBounds: Readonly<Record<string, SpatialBounds>> = {},
  backgroundPageSizes: Readonly<Record<string, BackgroundPageSize>> = {},
): HallScene {
  const measuredBuild = snapshot.seats.length >= 5_000;
  const revision = ++sceneBuildSequence;
  const buildName = measuredBuild
    ? `hall:scene-index:${snapshot.id}:${floorId}:${revision}`
    : '';
  if (measuredBuild) globalThis.performance?.mark(`${buildName}:start`);
  const seats = snapshot.seats.filter((seat) => seat.floorId === floorId);
  const rows = snapshot.rows
    .filter((row) => row.floorId === floorId)
    .map((row) => {
      const points = rowPoints(row);
      return { row, points, bounds: boundsOfPoints(points) };
    });
  const tables = snapshot.tables.filter((table) => table.floorId === floorId);
  const decorations = snapshot.decorations.filter(
    (item) => item.floorId === floorId,
  );
  const sceneItems: SceneItem<HallTarget>[] = [];
  const memberBounds = new Map<string, SpatialBounds>();
  const targetOrderById = new Map<string, number>();
  const allBounds: SpatialBounds[] = [];
  let nextTargetOrder = 0;
  const backgrounds = snapshot.backgrounds
    .filter(
      (background) => background.floorId === floorId && background.visible,
    )
    .flatMap((background) => {
      const pageKey = `${background.source.assetId}:${background.source.kind === 'pdf' ? background.source.pageNumber : 1}`;
      const size = backgroundPageSizes[pageKey];
      if (!size) return [];
      const bounds = backgroundBounds(background, size);
      allBounds.push(bounds);
      return [
        { background, pageKey, width: size.width, height: size.height, bounds },
      ];
    })
    .sort((first, second) => first.background.order - second.background.order);

  function add(
    kind: HallTarget['kind'],
    id: string,
    bounds: SpatialBounds,
    zoneId?: string,
  ): void {
    const key = `${kind}:${id}`;
    const target = { kind, id };
    sceneItems.push({ id, floorId, kind, bounds, geometry: target });
    targetOrderById.set(key, nextTargetOrder++);
    if (kind !== 'zone') allBounds.push(bounds);
    if (zoneId) {
      const previous = memberBounds.get(zoneId);
      memberBounds.set(
        zoneId,
        previous ? mergeBounds(previous, bounds) : bounds,
      );
    }
  }

  rows.forEach(({ row, bounds }) =>
    add('row', row.id, expandBounds(bounds, rowTolerance), row.zoneId),
  );
  tables.forEach((table) =>
    add('table', table.id, tableBounds(table), table.zoneId),
  );
  seats.forEach((seat) =>
    add('seat', seat.id, seatSymbolBounds(seat), seat.zoneId),
  );
  decorations.forEach((decoration) =>
    add(
      'decoration',
      decoration.id,
      decoration.kind === 'label'
        ? pointBounds(decoration.position, 1.2)
        : boundsOfPoints(decoration.polygon),
    ),
  );

  const floorZones = snapshot.zones.filter((zone) => zone.floorId === floorId);
  const occupiedBounds: SpatialBounds[] = [...allBounds];
  floorZones.forEach((zone) => {
    const explicit = explicitZoneBounds[zone.id];
    if (explicit) occupiedBounds.push(explicit);
    if (zone.polygon) occupiedBounds.push(boundsOfPoints(zone.polygon));
  });
  const occupied =
    occupiedBounds.length > 0
      ? occupiedBounds.reduce(mergeBounds)
      : pointBounds({ x: 0, y: 0 }, 10);
  let standaloneZoneIndex = 0;

  const zones = floorZones.flatMap((zone) => {
    const members = memberBounds.get(zone.id);
    const bounds =
      (zone.polygon ? boundsOfPoints(zone.polygon) : undefined) ??
      explicitZoneBounds[zone.id] ??
      (members
        ? expandBounds(members, zonePadding)
        : {
            minX: occupied.maxX + 4,
            minY: occupied.minY + standaloneZoneIndex * 10,
            maxX: occupied.maxX + 16,
            maxY: occupied.minY + standaloneZoneIndex * 10 + 8,
          });
    if (!members && !explicitZoneBounds[zone.id] && !zone.polygon)
      standaloneZoneIndex += 1;
    add('zone', zone.id, bounds);
    allBounds.push(bounds);
    return [{ zone, bounds }];
  });
  const bounds =
    allBounds.length > 0
      ? allBounds.reduce(mergeBounds)
      : pointBounds({ x: 0, y: 0 }, 10);
  const index = createRendererScene(revision, sceneItems);
  if (measuredBuild) {
    globalThis.performance?.mark(`${buildName}:end`);
    globalThis.performance?.measure(
      buildName,
      `${buildName}:start`,
      `${buildName}:end`,
    );
  }
  return {
    floorId,
    seats,
    rows,
    tables,
    zones,
    decorations,
    backgrounds,
    seatsById: new Map(seats.map((seat) => [seat.id, seat])),
    rowsById: new Map(rows.map((row) => [row.row.id, row])),
    tablesById: new Map(tables.map((table) => [table.id, table])),
    zonesById: new Map(zones.map((zone) => [zone.zone.id, zone])),
    decorationsById: new Map(decorations.map((item) => [item.id, item])),
    targetOrderById,
    bounds,
    index,
  };
}

function boundsIntersect(first: SpatialBounds, second: SpatialBounds): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

export function visibleHallScene(
  scene: HallScene,
  bounds: SpatialBounds,
  movingKeys?: ReadonlySet<string>,
  delta?: Vector2,
): VisibleHallScene {
  const visibleTargets = new Map<string, HallTarget>();
  for (const { value } of scene.index.index.search(bounds)) {
    const target = value.geometry;
    visibleTargets.set(`${target.kind}:${target.id}`, target);
  }
  if (movingKeys && delta) {
    const originalBounds = {
      minX: bounds.minX - delta.x,
      minY: bounds.minY - delta.y,
      maxX: bounds.maxX - delta.x,
      maxY: bounds.maxY - delta.y,
    };
    for (const { value } of scene.index.index.search(originalBounds)) {
      const target = value.geometry;
      const key = `${target.kind}:${target.id}`;
      if (movingKeys.has(key)) visibleTargets.set(key, target);
    }
  }
  const orderedTargets = [...visibleTargets.entries()].sort(
    ([first], [second]) =>
      (scene.targetOrderById.get(first) ?? Number.MAX_SAFE_INTEGER) -
      (scene.targetOrderById.get(second) ?? Number.MAX_SAFE_INTEGER),
  );
  const seats: HallScene['seats'][number][] = [];
  const rows: HallScene['rows'][number][] = [];
  const tables: HallScene['tables'][number][] = [];
  const zones: HallScene['zones'][number][] = [];
  const decorations: HallScene['decorations'][number][] = [];
  for (const [, target] of orderedTargets) {
    switch (target.kind) {
      case 'seat': {
        const item = scene.seatsById.get(target.id);
        if (item) seats.push(item);
        break;
      }
      case 'row': {
        const item = scene.rowsById.get(target.id);
        if (item) rows.push(item);
        break;
      }
      case 'table': {
        const item = scene.tablesById.get(target.id);
        if (item) tables.push(item);
        break;
      }
      case 'zone': {
        const item = scene.zonesById.get(target.id);
        if (item) zones.push(item);
        break;
      }
      case 'decoration': {
        const item = scene.decorationsById.get(target.id);
        if (item) decorations.push(item);
        break;
      }
    }
  }
  return {
    seats,
    rows,
    tables,
    zones,
    decorations,
    backgrounds: scene.backgrounds.filter(({ bounds: item }) =>
      boundsIntersect(item, bounds),
    ),
  };
}

function isInsideTable(table: Table, point: Vector2): boolean {
  const dx = point.x - table.center.x;
  const dy = point.y - table.center.y;
  if (table.shape.kind === 'circle')
    return dx * dx + dy * dy <= table.shape.radius ** 2;
  const cosine = Math.cos(table.rotationRadians);
  const sine = Math.sin(table.rotationRadians);
  const localX = dx * cosine + dy * sine;
  const localY = -dx * sine + dy * cosine;
  return (
    Math.abs(localX) <= table.shape.width / 2 &&
    Math.abs(localY) <= table.shape.height / 2
  );
}

export function hitTestHallScene(
  scene: HallScene,
  point: Vector2,
  tolerance = 0,
  allowedKinds?: ReadonlySet<HallTarget['kind']>,
): HallTarget | null {
  const hit = hitTestScene(
    scene.index,
    point,
    (item, hitPoint, hitTolerance) => {
      const value = item.geometry;
      switch (value.kind) {
        case 'seat': {
          const seat = scene.seatsById.get(value.id);
          return Boolean(seat && hitSeatSymbol(seat, hitPoint, hitTolerance));
        }
        case 'table': {
          const table = scene.tablesById.get(value.id);
          return Boolean(table && isInsideTable(table, hitPoint));
        }
        case 'row': {
          const row = scene.rowsById.get(value.id);
          return Boolean(
            row?.points.some((start, index) => {
              const end = row.points[index + 1];
              return (
                end &&
                distanceToSegment({ start, end }, hitPoint) <=
                  rowTolerance + hitTolerance
              );
            }),
          );
        }
        case 'zone': {
          const zone = scene.zonesById.get(value.id);
          return Boolean(
            zone &&
            (zone.zone.polygon
              ? isPointInPolygon(zone.zone.polygon, hitPoint)
              : hitPoint.x >= zone.bounds.minX &&
                hitPoint.x <= zone.bounds.maxX &&
                hitPoint.y >= zone.bounds.minY &&
                hitPoint.y <= zone.bounds.maxY),
          );
        }
        case 'decoration': {
          const decoration = scene.decorationsById.get(value.id);
          return Boolean(
            decoration &&
            (decoration.kind === 'label'
              ? distanceBetweenVectors(decoration.position, hitPoint) <=
                1.2 + hitTolerance
              : isPointInPolygon(decoration.polygon, hitPoint)),
          );
        }
      }
    },
    {
      floorId: scene.floorId,
      tolerance,
      ...(allowedKinds ? { allowedKinds } : {}),
      kindPriority: ['seat', 'table', 'row', 'decoration', 'zone'],
      compareWithinKind: (first, second) => {
        if (first.kind !== 'seat' || second.kind !== 'seat') return 0;
        const firstSeat = scene.seatsById.get(first.id);
        const secondSeat = scene.seatsById.get(second.id);
        if (!firstSeat || !secondSeat) return 0;
        return (
          distanceBetweenVectors(firstSeat.position, point) -
          distanceBetweenVectors(secondSeat.position, point)
        );
      },
    },
  );
  return hit?.geometry ?? null;
}

export function targetBounds(
  scene: HallScene,
  target: HallTarget,
): SpatialBounds | null {
  return (
    scene.index.index.get(
      sceneItemKey({
        floorId: scene.floorId,
        kind: target.kind,
        id: target.id,
      }),
    )?.bounds ?? null
  );
}

export function selectionBounds(
  scene: HallScene,
  targets: readonly HallTarget[],
): SpatialBounds | null {
  const bounds = targets.flatMap((target) => {
    const item = targetBounds(scene, target);
    return item ? [item] : [];
  });
  return bounds.length > 0 ? bounds.reduce(mergeBounds) : null;
}

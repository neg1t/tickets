import type { LayoutSnapshot } from '@hall-platform/domain';
import {
  distanceToPolygonBoundary,
  isPointInPolygon,
  polygonArea,
  polygonBounds,
  SpatialIndex,
  type Polygon,
  type SpatialBounds,
  type Vector2,
} from '@hall-platform/geometry';
import type { HallTarget } from '@hall-platform/renderer-core';

const worldTolerance = 1e-6;

export type PricingTargetDiagnostic = Readonly<{
  severity: 'error' | 'warning';
  code:
    | 'unknown_zone'
    | 'unknown_seat'
    | 'unknown_row'
    | 'unknown_table'
    | 'unknown_row'
    | 'unknown_table'
    | 'unsupported_target'
    | 'invalid_zone_polygon'
    | 'invalid_zone_bounds'
    | 'zone_without_geometry'
    | 'linked_seat_outside_geometry'
    | 'different_zone_overlap'
    | 'ga_zone_contains_seats';
  targetId: string;
  relatedSeatId?: string;
  message: string;
}>;

export type PricingTargetOverlap = Readonly<{
  zoneId: string;
  seatId: string;
}>;

export type PricingTargetResolution = Readonly<{
  seatIds: readonly string[];
  gaZoneIds: readonly string[];
  overlaps: readonly PricingTargetOverlap[];
  diagnostics: readonly PricingTargetDiagnostic[];
}>;

type ZoneResolution = PricingTargetResolution;
type ZoneGeometry =
  | Readonly<{ kind: 'polygon'; polygon: Polygon; bounds: SpatialBounds }>
  | Readonly<{ kind: 'bounds'; bounds: SpatialBounds }>;

function targetResolution(
  seatIds: Iterable<string> = [],
  gaZoneIds: Iterable<string> = [],
  overlaps: readonly PricingTargetOverlap[] = [],
  diagnostics: readonly PricingTargetDiagnostic[] = [],
): PricingTargetResolution {
  return {
    seatIds: [...new Set(seatIds)].sort(),
    gaZoneIds: [...new Set(gaZoneIds)].sort(),
    overlaps,
    diagnostics,
  };
}

function samePoint(first: Vector2, second: Vector2): boolean {
  return first.x === second.x && first.y === second.y;
}

function cross(start: Vector2, end: Vector2, point: Vector2): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  );
}

function onSegment(start: Vector2, end: Vector2, point: Vector2): boolean {
  return (
    Math.abs(cross(start, end, point)) <= worldTolerance &&
    point.x >= Math.min(start.x, end.x) - worldTolerance &&
    point.x <= Math.max(start.x, end.x) + worldTolerance &&
    point.y >= Math.min(start.y, end.y) - worldTolerance &&
    point.y <= Math.max(start.y, end.y) + worldTolerance
  );
}

function segmentsIntersect(
  firstStart: Vector2,
  firstEnd: Vector2,
  secondStart: Vector2,
  secondEnd: Vector2,
): boolean {
  const firstSide = cross(firstStart, firstEnd, secondStart);
  const secondSide = cross(firstStart, firstEnd, secondEnd);
  const thirdSide = cross(secondStart, secondEnd, firstStart);
  const fourthSide = cross(secondStart, secondEnd, firstEnd);
  if (
    (firstSide > worldTolerance && secondSide < -worldTolerance ||
      firstSide < -worldTolerance && secondSide > worldTolerance) &&
    (thirdSide > worldTolerance && fourthSide < -worldTolerance ||
      thirdSide < -worldTolerance && fourthSide > worldTolerance)
  )
    return true;
  return (
    (Math.abs(firstSide) <= worldTolerance &&
      onSegment(firstStart, firstEnd, secondStart)) ||
    (Math.abs(secondSide) <= worldTolerance &&
      onSegment(firstStart, firstEnd, secondEnd)) ||
    (Math.abs(thirdSide) <= worldTolerance &&
      onSegment(secondStart, secondEnd, firstStart)) ||
    (Math.abs(fourthSide) <= worldTolerance &&
      onSegment(secondStart, secondEnd, firstEnd))
  );
}

function isSimplePolygon(points: Polygon): boolean {
  const vertices =
    points.length > 1 && samePoint(points[0]!, points.at(-1)!)
      ? points.slice(0, -1)
      : points;
  if (
    vertices.length < 3 ||
    new Set(vertices.map(({ x, y }) => `${x}:${y}`)).size < 3 ||
    polygonArea(vertices) <= worldTolerance * worldTolerance
  )
    return false;

  for (let first = 0; first < vertices.length; first += 1) {
    const firstStart = vertices[first];
    const firstEnd = vertices[(first + 1) % vertices.length];
    if (!firstStart || !firstEnd) return false;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondEndIndex = (second + 1) % vertices.length;
      if (second === first || second === (first + 1) % vertices.length)
        continue;
      if (first === (second + 1) % vertices.length) continue;
      const secondStart = vertices[second];
      const secondEnd = vertices[secondEndIndex];
      if (
        secondStart &&
        secondEnd &&
        segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)
      )
        return false;
    }
  }
  return true;
}

function validBounds(value: SpatialBounds): boolean {
  return (
    Number.isFinite(value.minX) &&
    Number.isFinite(value.minY) &&
    Number.isFinite(value.maxX) &&
    Number.isFinite(value.maxY) &&
    value.minX < value.maxX &&
    value.minY < value.maxY
  );
}

function pointInBounds(point: Vector2, bounds: SpatialBounds): boolean {
  return (
    point.x >= bounds.minX - worldTolerance &&
    point.x <= bounds.maxX + worldTolerance &&
    point.y >= bounds.minY - worldTolerance &&
    point.y <= bounds.maxY + worldTolerance
  );
}

function pointInGeometry(point: Vector2, geometry: ZoneGeometry): boolean {
  if (geometry.kind === 'bounds') return pointInBounds(point, geometry.bounds);
  if ((distanceToPolygonBoundary(geometry.polygon, point) ?? Infinity) <= worldTolerance)
    return true;
  return isPointInPolygon(geometry.polygon, point);
}

function geometryForZone(
  zoneId: string,
  zone: LayoutSnapshot['zones'][number],
  zoneBounds: Readonly<Record<string, SpatialBounds>>,
):
  | Readonly<{ geometry: ZoneGeometry | null; diagnostic: null }>
  | Readonly<{ geometry: null; diagnostic: PricingTargetDiagnostic }> {
  if (zone.polygon !== undefined) {
    if (!isSimplePolygon(zone.polygon)) {
      return {
        geometry: null,
        diagnostic: {
          severity: 'error',
          code: 'invalid_zone_polygon',
          targetId: zoneId,
          message: `Zone ${zone.name} has invalid polygon geometry.`,
        },
      };
    }
    const bounds = polygonBounds(zone.polygon);
    if (!bounds) {
      return {
        geometry: null,
        diagnostic: {
          severity: 'error',
          code: 'invalid_zone_polygon',
          targetId: zoneId,
          message: `Zone ${zone.name} has no usable polygon bounds.`,
        },
      };
    }
    return {
      geometry: {
        kind: 'polygon',
        polygon: zone.polygon,
        bounds,
      },
      diagnostic: null,
    };
  }

  const bounds = zoneBounds[zoneId];
  if (bounds !== undefined) {
    if (!validBounds(bounds)) {
      return {
        geometry: null,
        diagnostic: {
          severity: 'error',
          code: 'invalid_zone_bounds',
          targetId: zoneId,
          message: `Zone ${zone.name} has invalid saved bounds.`,
        },
      };
    }
    return { geometry: { kind: 'bounds', bounds }, diagnostic: null };
  }

  return {
    geometry: null,
    diagnostic: {
      severity: 'warning',
      code: 'zone_without_geometry',
      targetId: zoneId,
      message: `Zone ${zone.name} has no polygon or saved bounds; only explicit links are used.`,
    },
  };
}

function mergeDiagnostics(
  items: readonly PricingTargetDiagnostic[],
): PricingTargetDiagnostic[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.code}:${item.targetId}:${item.relatedSeatId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createPricingTargetResolver(
  snapshot: LayoutSnapshot,
  zoneBounds: Readonly<Record<string, SpatialBounds>> = {},
) {
  const floorIndexes = new Map<string, SpatialIndex<LayoutSnapshot['seats'][number]>>();
  const seatsById = new Map<string, LayoutSnapshot['seats'][number]>(
    snapshot.seats.map((seat): [string, LayoutSnapshot['seats'][number]] => [seat.id, seat]),
  );
  const rowsById = new Map<string, LayoutSnapshot['rows'][number]>(
    snapshot.rows.map((row): [string, LayoutSnapshot['rows'][number]] => [row.id, row]),
  );
  const tablesById = new Map<string, LayoutSnapshot['tables'][number]>(
    snapshot.tables.map((table): [string, LayoutSnapshot['tables'][number]] => [table.id, table]),
  );
  const zonesById = new Map<string, LayoutSnapshot['zones'][number]>(
    snapshot.zones.map((zone): [string, LayoutSnapshot['zones'][number]] => [zone.id, zone]),
  );
  const seatIdsByZone = new Map<string, Set<string>>();
  const seatIdsByParent = new Map<string, Set<string>>();

  const addToIndex = (map: Map<string, Set<string>>, key: string, id: string) => {
    const values = map.get(key) ?? new Set<string>();
    values.add(id);
    map.set(key, values);
  };

  for (const seat of snapshot.seats) {
    if (seat.zoneId) addToIndex(seatIdsByZone, seat.zoneId, seat.id);
    if (seat.placement.kind === 'row') {
      addToIndex(seatIdsByParent, `row:${seat.placement.rowId}`, seat.id);
      const parent = rowsById.get(seat.placement.rowId);
      if (parent?.zoneId) addToIndex(seatIdsByZone, parent.zoneId, seat.id);
    } else if (seat.placement.kind === 'table') {
      addToIndex(seatIdsByParent, `table:${seat.placement.tableId}`, seat.id);
      const parent = tablesById.get(seat.placement.tableId);
      if (parent?.zoneId) addToIndex(seatIdsByZone, parent.zoneId, seat.id);
    }

    let index = floorIndexes.get(seat.floorId);
    if (!index) {
      index = new SpatialIndex<LayoutSnapshot['seats'][number]>(16);
      floorIndexes.set(seat.floorId, index);
    }
    index.upsert(
      seat.id,
      {
        minX: seat.position.x,
        minY: seat.position.y,
        maxX: seat.position.x,
        maxY: seat.position.y,
      },
      seat,
    );
  }

  const zoneCache = new Map<string, ZoneResolution>();

  function resolveZone(zoneId: string): ZoneResolution {
    const cached = zoneCache.get(zoneId);
    if (cached) return cached;
    const zone = zonesById.get(zoneId);
    if (!zone) {
      const missing = targetResolution([], [], [], [
        {
          severity: 'error',
          code: 'unknown_zone',
          targetId: zoneId,
          message: `Zone ${zoneId} is not in this layout version.`,
        },
      ]);
      zoneCache.set(zoneId, missing);
      return missing;
    }

    const geometryResult = geometryForZone(zoneId, zone, zoneBounds);
    if (geometryResult.diagnostic?.severity === 'error') {
      const invalid = targetResolution([], [], [], [geometryResult.diagnostic]);
      zoneCache.set(zoneId, invalid);
      return invalid;
    }
    const geometry = geometryResult.geometry;
    const diagnostics: PricingTargetDiagnostic[] = geometryResult.diagnostic
      ? [geometryResult.diagnostic]
      : [];
    const linkedSeatIds = new Set(seatIdsByZone.get(zoneId) ?? []);
    const geometricSeatIds = new Set<string>();

    if (geometry) {
      const candidates = floorIndexes.get(zone.floorId)?.search({
        minX: geometry.bounds.minX - worldTolerance,
        minY: geometry.bounds.minY - worldTolerance,
        maxX: geometry.bounds.maxX + worldTolerance,
        maxY: geometry.bounds.maxY + worldTolerance,
      }) ?? [];
      for (const { id, value } of candidates) {
        if (pointInGeometry(value.position, geometry)) geometricSeatIds.add(id);
      }
    }

    const allSeatIds = new Set([...linkedSeatIds, ...geometricSeatIds]);
    if (zone.kind === 'ga' && allSeatIds.size > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'ga_zone_contains_seats',
        targetId: zoneId,
        message: `GA zone ${zone.name} overlaps ${allSeatIds.size} seated targets.`,
      });
      const blocked = targetResolution([], [], [], diagnostics);
      zoneCache.set(zoneId, blocked);
      return blocked;
    }

    const overlaps: PricingTargetOverlap[] = [];
    if (geometry) {
      for (const seatId of linkedSeatIds) {
        const seat = seatsById.get(seatId);
        if (seat && !pointInGeometry(seat.position, geometry)) {
          diagnostics.push({
            severity: 'warning',
            code: 'linked_seat_outside_geometry',
            targetId: zoneId,
            relatedSeatId: seatId,
            message: `Linked seat ${seatId} is outside the saved geometry of ${zone.name}.`,
          });
        }
      }
      for (const seatId of geometricSeatIds) {
        const seat = seatsById.get(seatId);
        if (seat?.zoneId && seat.zoneId !== zoneId) {
          overlaps.push({ zoneId, seatId });
          diagnostics.push({
            severity: 'warning',
            code: 'different_zone_overlap',
            targetId: zoneId,
            relatedSeatId: seatId,
            message: `Seat ${seatId} is linked to ${seat.zoneId} but lies inside ${zone.name}.`,
          });
        }
      }
    }

    const resolved =
      zone.kind === 'ga'
        ? targetResolution([], [zoneId], overlaps, diagnostics)
        : targetResolution(allSeatIds, [], overlaps, diagnostics);
    zoneCache.set(zoneId, resolved);
    return resolved;
  }

  function resolveTargets(targets: readonly HallTarget[]): PricingTargetResolution {
    const seatIds = new Set<string>();
    const gaZoneIds = new Set<string>();
    const overlaps: PricingTargetOverlap[] = [];
    const diagnostics: PricingTargetDiagnostic[] = [];

    for (const target of targets) {
      if (target.kind === 'seat') {
        if (!seatsById.has(target.id)) {
          diagnostics.push({
            severity: 'error',
            code: 'unknown_seat',
            targetId: target.id,
            message: `Seat ${target.id} is not in this layout version.`,
          });
        } else seatIds.add(target.id);
        continue;
      }
      if (target.kind === 'zone') {
        const zoneResult = resolveZone(target.id);
        zoneResult.seatIds.forEach((id) => seatIds.add(id));
        zoneResult.gaZoneIds.forEach((id) => gaZoneIds.add(id));
        overlaps.push(...zoneResult.overlaps);
        diagnostics.push(...zoneResult.diagnostics);
        continue;
      }
      if (target.kind === 'row' || target.kind === 'table') {
        const parentExists =
          target.kind === 'row'
            ? rowsById.has(target.id)
            : tablesById.has(target.id);
        if (!parentExists) {
          diagnostics.push({
            severity: 'error',
            code: target.kind === 'row' ? 'unknown_row' : 'unknown_table',
            targetId: target.id,
            message: `${target.kind === 'row' ? 'Row' : 'Table'} ${target.id} is not in this layout version.`,
          });
        }
        (seatIdsByParent.get(`${target.kind}:${target.id}`) ?? []).forEach(
          (id) => seatIds.add(id),
        );
        continue;
      }
      diagnostics.push({
        severity: 'error',
        code: 'unsupported_target',
        targetId: target.id,
        message: `Target ${target.kind}:${target.id} cannot receive a pricing assignment.`,
      });
    }

    return targetResolution(seatIds, gaZoneIds, overlaps, mergeDiagnostics(diagnostics));
  }

  return { resolveZone, resolveTargets } as const;
}

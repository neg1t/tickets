import type {
  LayoutSnapshot,
  PricingAssignmentDocument,
  PricingAssignmentValidationIssue,
  PricingCatalog,
} from '@hall-platform/domain';
import {
  getPricingCatalogDiagnostics,
  validatePricingAssignments,
} from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import {
  createPricingTargetResolver,
  type PricingTargetDiagnostic,
} from './resolvePricingTargets.js';

export type PricingZoneSummary = Readonly<{
  zoneId: string;
  kind: 'seated' | 'ga' | 'unknown';
  status:
    | 'uniform'
    | 'mixed'
    | 'partially_unassigned'
    | 'unassigned'
    | 'empty'
    | 'assigned'
    | 'invalid';
  segmentIds: readonly string[];
  segmentId?: string;
  seatCount: number;
  assignedCount: number;
  unassignedCount: number;
  capacity?: number;
  overlapCount: number;
  diagnostics: readonly PricingTargetDiagnostic[];
}>;

export type PricingDiagnostics = Readonly<{
  coverage: Readonly<{
    totalSeats: number;
    assignedSeats: number;
    unassignedSeats: number;
    totalGaZones: number;
    assignedGaZones: number;
    unassignedGaZones: number;
  }>;
  assignmentIssues: readonly PricingAssignmentValidationIssue[];
  catalogIssues: ReturnType<typeof getPricingCatalogDiagnostics>;
  targetDiagnostics: readonly PricingTargetDiagnostic[];
  zones: readonly PricingZoneSummary[];
}>;

export function getPricingZoneSummary(
  snapshot: LayoutSnapshot,
  document: PricingAssignmentDocument,
  zoneId: string,
  resolver = createPricingTargetResolver(snapshot),
): PricingZoneSummary {
  const zone = snapshot.zones.find(({ id }) => id === zoneId);
  const resolution = resolver.resolveZone(zoneId);
  const diagnostics = resolution.diagnostics;
  if (!zone) {
    return {
      zoneId,
      kind: 'unknown',
      status: 'invalid',
      segmentIds: [],
      seatCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      overlapCount: resolution.overlaps.length,
      diagnostics,
    };
  }

  if (zone.kind === 'ga') {
    const segmentId = document.assignments.gaZoneSegments[zoneId];
    const invalid = diagnostics.some(({ severity }) => severity === 'error');
    return {
      zoneId,
      kind: 'ga',
      status: invalid ? 'invalid' : segmentId ? 'assigned' : 'unassigned',
      segmentIds: segmentId ? [segmentId] : [],
      ...(segmentId ? { segmentId } : {}),
      seatCount: 0,
      assignedCount: segmentId ? 1 : 0,
      unassignedCount: segmentId ? 0 : 1,
      ...(zone.capacity === undefined ? {} : { capacity: zone.capacity }),
      overlapCount: resolution.overlaps.length,
      diagnostics,
    };
  }

  const segmentIds = [
    ...new Set(
      resolution.seatIds.flatMap((seatId) => {
        const segmentId = document.assignments.seatSegments[seatId];
        return segmentId ? [segmentId] : [];
      }),
    ),
  ].sort();
  const assignedCount = resolution.seatIds.filter(
    (seatId) => document.assignments.seatSegments[seatId] !== undefined,
  ).length;
  const unassignedCount = resolution.seatIds.length - assignedCount;
  const invalid = diagnostics.some(({ severity }) => severity === 'error');
  let status: PricingZoneSummary['status'];
  if (invalid) status = 'invalid';
  else if (resolution.seatIds.length === 0) status = 'empty';
  else if (assignedCount === 0) status = 'unassigned';
  else if (unassignedCount > 0) status = 'partially_unassigned';
  else if (segmentIds.length === 1) status = 'uniform';
  else status = 'mixed';

  return {
    zoneId,
    kind: 'seated',
    status,
    segmentIds,
    ...(segmentIds.length === 1 ? { segmentId: segmentIds[0] } : {}),
    seatCount: resolution.seatIds.length,
    assignedCount,
    unassignedCount,
    overlapCount: resolution.overlaps.length,
    diagnostics,
  };
}

export function getPricingDiagnostics(input: {
  snapshot: LayoutSnapshot;
  document: PricingAssignmentDocument;
  catalog: PricingCatalog;
  zoneBounds?: Readonly<Record<string, SpatialBounds>>;
  resolver?: ReturnType<typeof createPricingTargetResolver>;
}): PricingDiagnostics {
  const { snapshot, document, catalog } = input;
  const resolver =
    input.resolver ?? createPricingTargetResolver(snapshot, input.zoneBounds);
  const zones = snapshot.zones.map(({ id }) =>
    getPricingZoneSummary(snapshot, document, id, resolver),
  );
  const gaZones = snapshot.zones.filter(({ kind }) => kind === 'ga');
  const assignedSeats = snapshot.seats.filter(
    ({ id }) => document.assignments.seatSegments[id] !== undefined,
  ).length;
  const assignedGaZones = gaZones.filter(
    ({ id }) => document.assignments.gaZoneSegments[id] !== undefined,
  ).length;

  return {
    coverage: {
      totalSeats: snapshot.seats.length,
      assignedSeats,
      unassignedSeats: snapshot.seats.length - assignedSeats,
      totalGaZones: gaZones.length,
      assignedGaZones,
      unassignedGaZones: gaZones.length - assignedGaZones,
    },
    assignmentIssues: validatePricingAssignments(document, {
      occurrenceId: document.occurrenceId,
      layoutVersionId: snapshot.layoutVersionId,
      snapshot,
      catalog,
    }),
    catalogIssues: getPricingCatalogDiagnostics(catalog),
    targetDiagnostics: zones.flatMap(({ diagnostics }) => diagnostics),
    zones,
  };
}

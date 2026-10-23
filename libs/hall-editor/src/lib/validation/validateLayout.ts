import {
  layoutSnapshotSchema,
  type Row,
  type Seat,
} from '@hall-platform/domain';
import {
  distanceBetweenVectors,
  isPointInPolygon,
  polygonArea,
} from '@hall-platform/geometry';
import type { HallLayoutDraft } from '../editorDraft.js';

export type LayoutIssue = Readonly<{
  code:
    | 'broken-link'
    | 'empty-row'
    | 'degenerate-row'
    | 'duplicate-number'
    | 'seat-collision'
    | 'obstacle-collision'
    | 'degenerate-polygon'
    | 'ga-seat';
  severity: 'error' | 'warning';
  message: string;
  targetId?: string;
}>;

function rowIsDegenerate(row: Row): boolean {
  const curve = row.curve;
  if (curve.kind === 'line')
    return distanceBetweenVectors(curve.start, curve.end) < 0.001;
  if (curve.kind === 'arc')
    return (
      curve.radius < 0.001 ||
      Math.abs(curve.endAngle - curve.startAngle) < 0.001
    );
  if (curve.kind === 'polyline') {
    const first = curve.points[0];
    if (!first) return true;
    return curve.points.every(
      (point) => distanceBetweenVectors(point, first) < 0.001,
    );
  }
  return [curve.p1, curve.p2, curve.p3].every(
    (point) => distanceBetweenVectors(point, curve.p0) < 0.001,
  );
}

function numberingScope(seat: Seat): string {
  if (seat.placement.kind === 'row') return `row:${seat.placement.rowId}`;
  if (seat.placement.kind === 'table') return `table:${seat.placement.tableId}`;
  return seat.zoneId ? `zone:${seat.zoneId}` : `floor:${seat.floorId}`;
}

export function validateLayout(draft: HallLayoutDraft): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const snapshot = draft.snapshot;
  const parsed = layoutSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      issues.push({
        code: 'broken-link',
        severity: 'error',
        message: `${issue.path.join('.')}: ${issue.message}`,
      });
  }
  for (const row of snapshot.rows) {
    if (
      !snapshot.seats.some(
        (seat) =>
          seat.placement.kind === 'row' && seat.placement.rowId === row.id,
      )
    )
      issues.push({
        code: 'empty-row',
        severity: 'error',
        message: `Ряд «${row.name}» не содержит мест`,
        targetId: row.id,
      });
    if (rowIsDegenerate(row))
      issues.push({
        code: 'degenerate-row',
        severity: 'error',
        message: `Ряд «${row.name}» имеет нулевую длину`,
        targetId: row.id,
      });
  }
  const numbers = new Map<string, string>();
  for (const seat of snapshot.seats) {
    if (
      snapshot.zones.some(
        (zone) => zone.id === seat.zoneId && zone.kind === 'ga',
      )
    )
      issues.push({
        code: 'ga-seat',
        severity: 'error',
        message: `Место ${seat.label} привязано к GA-зоне`,
        targetId: seat.id,
      });
    const key = `${numberingScope(seat)}:${seat.label.trim().toLocaleLowerCase()}`;
    const previous = numbers.get(key);
    if (previous)
      issues.push({
        code: 'duplicate-number',
        severity: 'error',
        message: `Повтор номера ${seat.label} в одной области`,
        targetId: seat.id,
      });
    else numbers.set(key, seat.id);
  }
  for (let index = 0; index < snapshot.seats.length; index += 1) {
    const seat = snapshot.seats[index];
    if (!seat) continue;
    for (
      let otherIndex = index + 1;
      otherIndex < snapshot.seats.length;
      otherIndex += 1
    ) {
      const other = snapshot.seats[otherIndex];
      if (!other) continue;
      if (
        seat.floorId === other.floorId &&
        distanceBetweenVectors(seat.position, other.position) < 1.1
      )
        issues.push({
          code: 'seat-collision',
          severity: 'warning',
          message: `Места ${seat.label} и ${other.label} пересекаются`,
          targetId: seat.id,
        });
    }
    for (const obstacle of snapshot.decorations) {
      if (
        obstacle.kind === 'obstacle' &&
        obstacle.floorId === seat.floorId &&
        isPointInPolygon(obstacle.polygon, seat.position)
      )
        issues.push({
          code: 'obstacle-collision',
          severity: 'warning',
          message: `Место ${seat.label} находится внутри препятствия`,
          targetId: seat.id,
        });
    }
  }
  for (const zone of snapshot.zones) {
    if (zone.polygon && polygonArea(zone.polygon) < 0.001)
      issues.push({
        code: 'degenerate-polygon',
        severity: 'error',
        message: `Зона «${zone.name}» имеет вырожденный полигон`,
        targetId: zone.id,
      });
  }
  for (const decoration of snapshot.decorations) {
    if (decoration.kind !== 'label' && polygonArea(decoration.polygon) < 0.001)
      issues.push({
        code: 'degenerate-polygon',
        severity: 'error',
        message: 'Декорация имеет вырожденный полигон',
        targetId: decoration.id,
      });
  }
  return issues;
}

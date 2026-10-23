import type { LayoutSnapshot } from '@hall-platform/domain';
import type { HallTarget } from '../hallScene.js';

export function movedTargetKeys(
  snapshot: LayoutSnapshot,
  targets: readonly HallTarget[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  const rowIds = new Set<string>();
  const tableIds = new Set<string>();
  const zoneIds = new Set<string>();
  for (const target of targets) {
    keys.add(`${target.kind}:${target.id}`);
    if (target.kind === 'row') rowIds.add(target.id);
    if (target.kind === 'table') tableIds.add(target.id);
    if (target.kind === 'zone') zoneIds.add(target.id);
  }
  for (const row of snapshot.rows) {
    if (row.zoneId && zoneIds.has(row.zoneId)) {
      rowIds.add(row.id);
      keys.add(`row:${row.id}`);
    }
  }
  for (const table of snapshot.tables) {
    if (table.zoneId && zoneIds.has(table.zoneId)) {
      tableIds.add(table.id);
      keys.add(`table:${table.id}`);
    }
  }
  for (const seat of snapshot.seats) {
    if (
      (seat.zoneId && zoneIds.has(seat.zoneId)) ||
      (seat.placement.kind === 'row' && rowIds.has(seat.placement.rowId)) ||
      (seat.placement.kind === 'table' && tableIds.has(seat.placement.tableId))
    ) {
      keys.add(`seat:${seat.id}`);
    }
  }
  return keys;
}

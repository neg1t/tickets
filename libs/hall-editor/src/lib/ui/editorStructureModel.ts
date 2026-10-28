import type { LayoutSnapshot } from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';

export function hallTargetKey(target: HallTarget): string {
  return `${target.kind}:${target.id}`;
}

export function expandObjectTargetKeys(
  snapshot: LayoutSnapshot,
  directKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const expanded = new Set(directKeys);
  const hiddenZones = new Set(
    snapshot.zones
      .filter((zone) => directKeys.has(`zone:${zone.id}`))
      .map((zone) => zone.id),
  );
  const hiddenRows = new Set(
    snapshot.rows
      .filter(
        (row) =>
          directKeys.has(`row:${row.id}`) ||
          Boolean(row.zoneId && hiddenZones.has(row.zoneId)),
      )
      .map((row) => row.id),
  );
  const hiddenTables = new Set(
    snapshot.tables
      .filter(
        (table) =>
          directKeys.has(`table:${table.id}`) ||
          Boolean(table.zoneId && hiddenZones.has(table.zoneId)),
      )
      .map((table) => table.id),
  );

  for (const zoneId of hiddenZones) expanded.add(`zone:${zoneId}`);
  for (const rowId of hiddenRows) expanded.add(`row:${rowId}`);
  for (const tableId of hiddenTables) expanded.add(`table:${tableId}`);
  for (const seat of snapshot.seats) {
    if (
      directKeys.has(`seat:${seat.id}`) ||
      Boolean(seat.zoneId && hiddenZones.has(seat.zoneId)) ||
      (seat.placement.kind === 'row' &&
        hiddenRows.has(seat.placement.rowId)) ||
      (seat.placement.kind === 'table' &&
        hiddenTables.has(seat.placement.tableId))
    )
      expanded.add(`seat:${seat.id}`);
  }
  for (const decoration of snapshot.decorations)
    if (directKeys.has(`decoration:${decoration.id}`))
      expanded.add(`decoration:${decoration.id}`);
  return expanded;
}

export function filterHallSnapshotByTargets(
  snapshot: LayoutSnapshot,
  hiddenKeys: ReadonlySet<string>,
): LayoutSnapshot {
  if (hiddenKeys.size === 0) return snapshot;
  return {
    ...snapshot,
    zones: snapshot.zones.filter((zone) => !hiddenKeys.has(`zone:${zone.id}`)),
    rows: snapshot.rows.filter((row) => !hiddenKeys.has(`row:${row.id}`)),
    tables: snapshot.tables.filter((table) => !hiddenKeys.has(`table:${table.id}`)),
    seats: snapshot.seats.filter((seat) => !hiddenKeys.has(`seat:${seat.id}`)),
    decorations: snapshot.decorations.filter(
      (decoration) => !hiddenKeys.has(`decoration:${decoration.id}`),
    ),
  };
}

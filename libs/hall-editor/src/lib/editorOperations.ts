import {
  rowIdSchema,
  seatIdSchema,
  tableIdSchema,
  zoneIdSchema,
  worldPointSchema,
  type WorldPoint,
  type Row,
  type Seat,
  type Table,
  type Zone,
} from '@hall-platform/domain';
import {
  generateTableSeatSlots,
  type Vector2,
  type SpatialBounds,
} from '@hall-platform/geometry';
import type { HallTarget } from '@hall-platform/renderer-konva';
import type { EditorCommand, EditorPatch } from './editorCommands.js';
import type { HallLayoutDraft } from './editorDraft.js';
import {
  preserveSeatManualAdjustment,
  regenerateRowSeats,
  regenerateTableSeats,
} from './commands/regenerateSeats.js';
import { makeDecoration } from './commands/structureOperations.js';
import {
  transformRow,
  transformTable,
  translateRow,
} from './commands/transformSelection.js';

export type EditorTool =
  | 'select'
  | 'pan'
  | 'zone'
  | 'zone-ga'
  | 'stage'
  | 'obstacle'
  | 'label'
  | 'row-line'
  | 'row-arc'
  | 'row-bezier'
  | 'seat'
  | 'table-circle'
  | 'table-rectangle'
  | 'calibrate';

function translated(point: Vector2, delta: Vector2): WorldPoint {
  return worldPointSchema.parse({ x: point.x + delta.x, y: point.y + delta.y });
}

function zoneReference(zoneId?: string): { zoneId?: Zone['id'] } {
  return zoneId ? { zoneId: zoneIdSchema.parse(zoneId) } : {};
}

export function createObjectAt(
  draft: HallLayoutDraft,
  tool: EditorTool,
  point: Vector2,
  zoneId?: string,
  activeFloorId?: string,
  publishedSeatIds: readonly Seat['id'][] = [],
): { command: EditorCommand; target: HallTarget } {
  const floorId = activeFloorId
    ? draft.snapshot.floors.find((floor) => floor.id === activeFloorId)?.id
    : draft.snapshot.floors[0]?.id;
  if (!floorId) throw new Error('Draft requires a floor');
  if (
    zoneId &&
    !draft.snapshot.zones.some(
      (zone) => zone.id === zoneId && zone.floorId === floorId,
    )
  ) {
    throw new Error('Selected zone is not on the active floor');
  }
  if (
    zoneId &&
    [
      'row-line',
      'row-arc',
      'row-bezier',
      'seat',
      'table-circle',
      'table-rectangle',
    ].includes(tool) &&
    draft.snapshot.zones.find((zone) => zone.id === zoneId)?.kind === 'ga'
  )
    throw new Error('В GA-зоне нельзя создавать отдельные места');
  const id = crypto.randomUUID();
  switch (tool) {
    case 'zone':
    case 'zone-ga': {
      const zone: Zone = {
        id: zoneIdSchema.parse(`zone-${id}`),
        floorId,
        name: `Зона ${draft.snapshot.zones.length + 1}`,
        kind: tool === 'zone-ga' ? 'ga' : 'seated',
        ...(tool === 'zone-ga' ? { capacity: 20 } : {}),
      };
      const bounds: SpatialBounds = {
        minX: point.x - 5,
        minY: point.y - 4,
        maxX: point.x + 5,
        maxY: point.y + 4,
      };
      return {
        target: { kind: 'zone', id: zone.id },
        command: {
          kind: 'create',
          patches: [
            { collection: 'zones', id: zone.id, before: null, after: zone },
            {
              collection: 'zoneBounds',
              id: zone.id,
              before: null,
              after: bounds,
            },
          ],
        },
      };
    }
    case 'stage':
    case 'obstacle':
    case 'label': {
      const decoration = makeDecoration(draft, tool, point, floorId);
      return {
        target: { kind: 'decoration', id: decoration.id },
        command: {
          kind: 'create',
          patches: [
            {
              collection: 'decorations',
              id: decoration.id,
              before: null,
              after: decoration,
            },
          ],
        },
      };
    }
    case 'row-line':
    case 'row-arc':
    case 'row-bezier': {
      const curve: Row['curve'] =
        tool === 'row-line'
          ? {
              kind: 'line',
              start: worldPointSchema.parse({ x: point.x - 4, y: point.y }),
              end: worldPointSchema.parse({ x: point.x + 4, y: point.y }),
            }
          : tool === 'row-arc'
            ? {
                kind: 'arc',
                center: worldPointSchema.parse(point),
                radius: 4,
                startAngle: 0,
                endAngle: Math.PI,
              }
            : {
                kind: 'bezier',
                p0: worldPointSchema.parse({ x: point.x - 4, y: point.y }),
                p1: worldPointSchema.parse({ x: point.x - 2, y: point.y - 2 }),
                p2: worldPointSchema.parse({ x: point.x + 2, y: point.y - 2 }),
                p3: worldPointSchema.parse({ x: point.x + 4, y: point.y }),
              };
      const row: Row = {
        id: rowIdSchema.parse(`row-${id}`),
        floorId,
        ...zoneReference(zoneId),
        name: `Ряд ${draft.snapshot.rows.length + 1}`,
        curve,
        generation: { distribution: { kind: 'even', count: 8 } },
      };
      return {
        target: { kind: 'row', id: row.id },
        command: regenerateRowSeats(draft, null, row, { publishedSeatIds }),
      };
    }
    case 'seat': {
      const seat: Seat = {
        id: seatIdSchema.parse(`seat-${id}`),
        floorId,
        ...zoneReference(zoneId),
        label: `${draft.snapshot.seats.length + 1}`,
        position: worldPointSchema.parse(point),
        placement: { kind: 'standalone' },
      };
      return {
        target: { kind: 'seat', id: seat.id },
        command: {
          kind: 'create',
          patches: [
            { collection: 'seats', id: seat.id, before: null, after: seat },
          ],
        },
      };
    }
    case 'table-circle':
    case 'table-rectangle': {
      const shape: Table['shape'] =
        tool === 'table-circle'
          ? { kind: 'circle', radius: 2, seatCount: 6 }
          : {
              kind: 'rectangle',
              width: 5,
              height: 3,
              seatsPerSide: { top: 2, right: 2, bottom: 2, left: 2 },
            };
      const table: Table = {
        id: tableIdSchema.parse(`table-${id}`),
        floorId,
        ...zoneReference(zoneId),
        label: `Стол ${draft.snapshot.tables.length + 1}`,
        center: worldPointSchema.parse(point),
        rotationRadians: 0,
        shape,
        generation: { seatOffset: 0.6 },
      };
      return {
        target: { kind: 'table', id: table.id },
        command: regenerateTableSeats(draft, null, table, { publishedSeatIds }),
      };
    }
    default:
      throw new Error(`Tool ${tool} cannot create an object`);
  }
}

export function moveTarget(
  draft: HallLayoutDraft,
  target: HallTarget,
  delta: Vector2,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  const patches: EditorPatch[] = [];
  const { snapshot } = draft;
  if (target.kind === 'row') {
    const row = snapshot.rows.find((item) => item.id === target.id);
    return row
      ? {
          kind: 'move',
          patches: transformRow(
            draft,
            row,
            translateRow(row, delta),
            publishedSeatIds,
          ).patches,
        }
      : { kind: 'move', patches: [] };
  }
  if (target.kind === 'table') {
    const table = snapshot.tables.find((item) => item.id === target.id);
    return table
      ? {
          kind: 'move',
          patches: transformTable(
            draft,
            table,
            {
              ...table,
              center: translated(table.center, delta),
            },
            publishedSeatIds,
          ).patches,
        }
      : { kind: 'move', patches: [] };
  }
  function moveSeat(seat: Seat, individual = false): void {
    const after = { ...seat, position: translated(seat.position, delta) };
    patches.push({
      collection: 'seats',
      id: seat.id,
      before: seat,
      after: individual ? preserveSeatManualAdjustment(seat, after) : after,
    });
  }
  switch (target.kind) {
    case 'seat': {
      const seat = snapshot.seats.find((item) => item.id === target.id);
      if (seat) moveSeat(seat, true);
      break;
    }
    case 'decoration': {
      const decoration = snapshot.decorations.find(
        (item) => item.id === target.id,
      );
      if (decoration)
        patches.push({
          collection: 'decorations',
          id: decoration.id,
          before: decoration,
          after:
            decoration.kind === 'label'
              ? {
                  ...decoration,
                  position: translated(decoration.position, delta),
                }
              : {
                  ...decoration,
                  polygon: decoration.polygon.map((point) =>
                    translated(point, delta),
                  ),
                },
        });
      break;
    }
    case 'zone': {
      const zone = snapshot.zones.find((item) => item.id === target.id);
      if (zone?.polygon)
        patches.push({
          collection: 'zones',
          id: zone.id,
          before: zone,
          after: {
            ...zone,
            polygon: zone.polygon.map((point) => translated(point, delta)),
          },
        });
      const bounds = draft.zoneBounds[target.id];
      if (bounds)
        patches.push({
          collection: 'zoneBounds',
          id: target.id,
          before: bounds,
          after: {
            minX: bounds.minX + delta.x,
            maxX: bounds.maxX + delta.x,
            minY: bounds.minY + delta.y,
            maxY: bounds.maxY + delta.y,
          },
        });
      const rows = snapshot.rows.filter((row) => row.zoneId === target.id);
      const tables = snapshot.tables.filter(
        (table) => table.zoneId === target.id,
      );
      rows.forEach((row) =>
        patches.push(
          ...moveTarget(
            draft,
            { kind: 'row', id: row.id },
            delta,
            publishedSeatIds,
          ).patches,
        ),
      );
      tables.forEach((table) =>
        patches.push(
          ...moveTarget(
            draft,
            { kind: 'table', id: table.id },
            delta,
            publishedSeatIds,
          ).patches,
        ),
      );
      snapshot.seats
        .filter(
          (seat) =>
            seat.zoneId === target.id && seat.placement.kind === 'standalone',
        )
        .forEach((seat) => moveSeat(seat));
      break;
    }
  }
  return { kind: 'move', patches };
}

export function deleteTarget(
  draft: HallLayoutDraft,
  target: HallTarget,
): EditorCommand {
  const patches: EditorPatch[] = [];
  const { snapshot } = draft;
  const removeSeat = (seat: Seat) =>
    patches.push({
      collection: 'seats',
      id: seat.id,
      before: seat,
      after: null,
    } as const);
  const removeRow = (row: Row) =>
    patches.push({
      collection: 'rows',
      id: row.id,
      before: row,
      after: null,
    } as const);
  const removeTable = (table: Table) =>
    patches.push({
      collection: 'tables',
      id: table.id,
      before: table,
      after: null,
    } as const);
  if (target.kind === 'zone') {
    const rows = snapshot.rows.filter((row) => row.zoneId === target.id);
    const tables = snapshot.tables.filter(
      (table) => table.zoneId === target.id,
    );
    const rowIds = new Set(rows.map((row) => row.id));
    const tableIds = new Set(tables.map((table) => table.id));
    snapshot.seats
      .filter(
        (seat) =>
          seat.zoneId === target.id ||
          (seat.placement.kind === 'row' && rowIds.has(seat.placement.rowId)) ||
          (seat.placement.kind === 'table' &&
            tableIds.has(seat.placement.tableId)),
      )
      .forEach(removeSeat);
    rows.forEach(removeRow);
    tables.forEach(removeTable);
    const zone = snapshot.zones.find((item) => item.id === target.id);
    if (zone)
      patches.push({
        collection: 'zones',
        id: zone.id,
        before: zone,
        after: null,
      });
    const bounds = draft.zoneBounds[target.id];
    if (bounds)
      patches.push({
        collection: 'zoneBounds',
        id: target.id,
        before: bounds,
        after: null,
      });
  } else if (target.kind === 'row') {
    snapshot.seats
      .filter(
        (seat) =>
          seat.placement.kind === 'row' && seat.placement.rowId === target.id,
      )
      .forEach(removeSeat);
    const row = snapshot.rows.find((item) => item.id === target.id);
    if (row) removeRow(row);
  } else if (target.kind === 'table') {
    snapshot.seats
      .filter(
        (seat) =>
          seat.placement.kind === 'table' &&
          seat.placement.tableId === target.id,
      )
      .forEach(removeSeat);
    const table = snapshot.tables.find((item) => item.id === target.id);
    if (table) removeTable(table);
  } else if (target.kind === 'decoration') {
    const decoration = snapshot.decorations.find(
      (item) => item.id === target.id,
    );
    if (decoration)
      patches.push({
        collection: 'decorations',
        id: decoration.id,
        before: decoration,
        after: null,
      });
  } else {
    const seat = snapshot.seats.find((item) => item.id === target.id);
    if (seat?.placement.kind === 'row') {
      const rowId = seat.placement.rowId;
      const row = snapshot.rows.find((item) => item.id === rowId);
      if (row) {
        const attached = snapshot.seats.filter(
          (item) =>
            item.placement.kind === 'row' && item.placement.rowId === row.id,
        );
        const parsedSlot = Number(seat.slotKey);
        const slotIndex = Number.isSafeInteger(parsedSlot)
          ? parsedSlot
          : attached.indexOf(seat);
        const generation: NonNullable<Row['generation']> = row.generation ?? {
          distribution: { kind: 'even', count: attached.length },
        };
        const after = {
          ...row,
          generation: {
            ...generation,
            skippedSlots: [...(generation.skippedSlots ?? []), slotIndex],
          },
        };
        return {
          kind: 'delete',
          patches: regenerateRowSeats(draft, row, after).patches,
        };
      }
      removeSeat(seat);
    } else if (seat?.placement.kind === 'table') {
      const tableId = seat.placement.tableId;
      const table = snapshot.tables.find((item) => item.id === tableId);
      if (table) {
        const attached = snapshot.seats.filter(
          (item) =>
            item.placement.kind === 'table' &&
            item.placement.tableId === table.id,
        );
        const slotKey =
          seat.slotKey ??
          generateTableSeatSlots(
            table,
            table.generation ?? { seatOffset: 0.6 },
          )[attached.indexOf(seat)]?.slotKey;
        if (slotKey) {
          const generation: NonNullable<Table['generation']> =
            table.generation ?? { seatOffset: 0.6 };
          const after = {
            ...table,
            generation: {
              ...generation,
              skippedSlotKeys: [...(generation.skippedSlotKeys ?? []), slotKey],
            },
          };
          return {
            kind: 'delete',
            patches: regenerateTableSeats(draft, table, after).patches,
          };
        }
      }
      removeSeat(seat);
    } else if (seat) removeSeat(seat);
  }
  return { kind: 'delete', patches };
}

function uniquePatches(commands: readonly EditorCommand[]): EditorPatch[] {
  const patches = new Map<string, EditorPatch>();
  for (const command of commands) {
    for (const patch of command.patches) {
      const key =
        patch.collection === 'calibration'
          ? 'calibration'
          : `${patch.collection}:${patch.id}`;
      if (!patches.has(key)) patches.set(key, patch);
    }
  }
  return [...patches.values()];
}

export function moveTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  delta: Vector2,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    throw new RangeError('Move delta must be finite');
  if (delta.x === 0 && delta.y === 0) return { kind: 'move', patches: [] };
  return {
    kind: 'move',
    patches: uniquePatches(
      targets.map((target) =>
        moveTarget(draft, target, delta, publishedSeatIds),
      ),
    ),
  };
}

export function deleteTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
): EditorCommand {
  const { snapshot } = draft;
  const selected = new Set(
    targets.map((target) => `${target.kind}:${target.id}`),
  );
  const effective = targets.filter((target) => {
    if (target.kind === 'row') {
      const row = snapshot.rows.find((item) => item.id === target.id);
      return !row?.zoneId || !selected.has(`zone:${row.zoneId}`);
    }
    if (target.kind === 'table') {
      const table = snapshot.tables.find((item) => item.id === target.id);
      return !table?.zoneId || !selected.has(`zone:${table.zoneId}`);
    }
    if (target.kind !== 'seat') return true;
    const seat = snapshot.seats.find((item) => item.id === target.id);
    if (!seat) return false;
    if (seat.zoneId && selected.has(`zone:${seat.zoneId}`)) return false;
    if (seat.placement.kind === 'row') {
      const rowId = seat.placement.rowId;
      const row = snapshot.rows.find((item) => item.id === rowId);
      return (
        !selected.has(`row:${rowId}`) &&
        (!row?.zoneId || !selected.has(`zone:${row.zoneId}`))
      );
    }
    if (seat.placement.kind === 'table') {
      const tableId = seat.placement.tableId;
      const table = snapshot.tables.find((item) => item.id === tableId);
      return (
        !selected.has(`table:${tableId}`) &&
        (!table?.zoneId || !selected.has(`zone:${table.zoneId}`))
      );
    }
    return true;
  });
  const groupedRows = new Map<string, Seat[]>();
  const groupedTables = new Map<string, Seat[]>();
  const individual = effective.filter((target) => {
    if (target.kind !== 'seat') return true;
    const seat = snapshot.seats.find((item) => item.id === target.id);
    if (seat?.placement.kind === 'row') {
      const group = groupedRows.get(seat.placement.rowId) ?? [];
      group.push(seat);
      groupedRows.set(seat.placement.rowId, group);
      return false;
    }
    if (seat?.placement.kind === 'table') {
      const group = groupedTables.get(seat.placement.tableId) ?? [];
      group.push(seat);
      groupedTables.set(seat.placement.tableId, group);
      return false;
    }
    return true;
  });
  const commands = individual.map((target) => deleteTarget(draft, target));
  for (const [rowId, seats] of groupedRows) {
    const row = snapshot.rows.find((item) => item.id === rowId);
    if (!row) continue;
    const attached = snapshot.seats.filter(
      (seat) => seat.placement.kind === 'row' && seat.placement.rowId === rowId,
    );
    const generation: NonNullable<Row['generation']> = row.generation ?? {
      distribution: { kind: 'even', count: attached.length },
    };
    const skippedSlots = [
      ...new Set([
        ...(generation.skippedSlots ?? []),
        ...seats.map((seat) => {
          const parsedSlot = Number(seat.slotKey);
          return Number.isSafeInteger(parsedSlot)
            ? parsedSlot
            : attached.indexOf(seat);
        }),
      ]),
    ];
    commands.push({
      kind: 'delete',
      patches: regenerateRowSeats(draft, row, {
        ...row,
        generation: { ...generation, skippedSlots },
      }).patches,
    });
  }
  for (const [tableId, seats] of groupedTables) {
    const table = snapshot.tables.find((item) => item.id === tableId);
    if (!table) continue;
    const attached = snapshot.seats.filter(
      (seat) =>
        seat.placement.kind === 'table' && seat.placement.tableId === tableId,
    );
    const oldSlots = generateTableSeatSlots(
      table,
      table.generation ?? { seatOffset: 0.6 },
    );
    const generation: NonNullable<Table['generation']> = table.generation ?? {
      seatOffset: 0.6,
    };
    const skippedSlotKeys = [
      ...new Set([
        ...(generation.skippedSlotKeys ?? []),
        ...seats.flatMap((seat) => {
          const key = seat.slotKey ?? oldSlots[attached.indexOf(seat)]?.slotKey;
          return key ? [key] : [];
        }),
      ]),
    ];
    commands.push({
      kind: 'delete',
      patches: regenerateTableSeats(draft, table, {
        ...table,
        generation: { ...generation, skippedSlotKeys },
      }).patches,
    });
  }
  return {
    kind: 'delete',
    patches: uniquePatches(commands),
  };
}

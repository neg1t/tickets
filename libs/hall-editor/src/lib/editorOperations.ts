import {
  decorationIdSchema,
  floorIdSchema,
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
import {
  buildHallScene,
  targetBounds,
  type HallTarget,
} from '@hall-platform/renderer-konva';
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
              start: worldPointSchema.parse({ x: point.x - 5.25, y: point.y }),
              end: worldPointSchema.parse({ x: point.x + 5.25, y: point.y }),
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
                p0: worldPointSchema.parse({ x: point.x - 5.25, y: point.y }),
                p1: worldPointSchema.parse({ x: point.x - 2.6, y: point.y - 2 }),
                p2: worldPointSchema.parse({ x: point.x + 2.6, y: point.y - 2 }),
                p3: worldPointSchema.parse({ x: point.x + 5.25, y: point.y }),
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

export function createStarterTemplate(
  draft: HallLayoutDraft,
  activeFloorId?: string,
): { command: EditorCommand; target: HallTarget } {
  const stage = createObjectAt(
    draft,
    'stage',
    { x: 0, y: -9 },
    undefined,
    activeFloorId,
  );
  const row = createObjectAt(
    draft,
    'row-line',
    { x: -5, y: 0 },
    undefined,
    activeFloorId,
  );
  const table = createObjectAt(
    draft,
    'table-circle',
    { x: 7, y: 2 },
    undefined,
    activeFloorId,
  );
  return {
    target: row.target,
    command: {
      kind: 'create',
      patches: [
        ...stage.command.patches,
        ...row.command.patches,
        ...table.command.patches,
      ],
    },
  };
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
      effectiveTargets(draft, targets).map((target) =>
        moveTarget(draft, target, delta, publishedSeatIds),
      ),
    ),
  };
}

type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type DistributionAxis = 'horizontal' | 'vertical';

function effectiveTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
): HallTarget[] {
  const selected = new Set(targets.map(({ kind, id }) => `${kind}:${id}`));
  return targets.filter((target, index) => {
    if (
      targets.findIndex(
        (item) => item.kind === target.kind && item.id === target.id,
      ) !== index
    )
      return false;
    if (target.kind === 'row' || target.kind === 'table') {
      const item = draft.snapshot[
        target.kind === 'row' ? 'rows' : 'tables'
      ].find((value) => value.id === target.id);
      return !item?.zoneId || !selected.has(`zone:${item.zoneId}`);
    }
    if (target.kind !== 'seat') return true;
    const seat = draft.snapshot.seats.find((item) => item.id === target.id);
    if (!seat) return false;
    if (seat.zoneId && selected.has(`zone:${seat.zoneId}`)) return false;
    if (seat.placement.kind === 'row')
      return !selected.has(`row:${seat.placement.rowId}`);
    if (seat.placement.kind === 'table')
      return !selected.has(`table:${seat.placement.tableId}`);
    return true;
  });
}

function targetGeometry(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
) {
  const scenes = new Map<string, ReturnType<typeof buildHallScene>>();
  return effectiveTargets(draft, targets).flatMap((target) => {
    const collection =
      target.kind === 'seat'
        ? draft.snapshot.seats
        : target.kind === 'row'
          ? draft.snapshot.rows
          : target.kind === 'table'
            ? draft.snapshot.tables
            : target.kind === 'zone'
              ? draft.snapshot.zones
              : draft.snapshot.decorations;
    const entity = collection.find((item) => item.id === target.id);
    if (!entity) return [];
    let scene = scenes.get(entity.floorId);
    if (!scene) {
      scene = buildHallScene(draft.snapshot, entity.floorId, draft.zoneBounds);
      scenes.set(entity.floorId, scene);
    }
    const bounds = targetBounds(scene, target);
    return bounds ? [{ target, bounds }] : [];
  });
}

export function alignTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  edge: AlignEdge,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  const items = targetGeometry(draft, targets);
  if (items.length < 2) return { kind: 'move', patches: [] };
  const axis =
    edge === 'left' || edge === 'center' || edge === 'right' ? 'x' : 'y';
  const start = axis === 'x' ? 'minX' : 'minY';
  const end = axis === 'x' ? 'maxX' : 'maxY';
  const outerStart = Math.min(...items.map(({ bounds }) => bounds[start]));
  const outerEnd = Math.max(...items.map(({ bounds }) => bounds[end]));
  const position =
    edge === 'left' || edge === 'top'
      ? outerStart
      : edge === 'right' || edge === 'bottom'
        ? outerEnd
        : (outerStart + outerEnd) / 2;
  const commands = items.map(({ target, bounds }) => {
    const current =
      edge === 'left' || edge === 'top'
        ? bounds[start]
        : edge === 'right' || edge === 'bottom'
          ? bounds[end]
          : (bounds[start] + bounds[end]) / 2;
    const distance = position - current;
    return moveTarget(
      draft,
      target,
      axis === 'x' ? { x: distance, y: 0 } : { x: 0, y: distance },
      publishedSeatIds,
    );
  });
  return { kind: 'move', patches: uniquePatches(commands) };
}

export function distributeTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  axis: DistributionAxis,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  const items = targetGeometry(draft, targets);
  if (items.length < 3) return { kind: 'move', patches: [] };
  const start = axis === 'horizontal' ? 'minX' : 'minY';
  const end = axis === 'horizontal' ? 'maxX' : 'maxY';
  const sorted = items
    .map((item) => ({
      ...item,
      center: (item.bounds[start] + item.bounds[end]) / 2,
    }))
    .sort((a, b) => a.center - b.center);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return { kind: 'move', patches: [] };
  const step = (last.center - first.center) / (sorted.length - 1);
  return {
    kind: 'move',
    patches: uniquePatches(
      sorted.slice(1, -1).map((item, index) => {
        const distance = first.center + step * (index + 1) - item.center;
        return moveTarget(
          draft,
          item.target,
          axis === 'horizontal' ? { x: distance, y: 0 } : { x: 0, y: distance },
          publishedSeatIds,
        );
      }),
    ),
  };
}

export function duplicateTargets(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  offset: Vector2 = { x: 2, y: 2 },
  targetFloorId?: string,
): { command: EditorCommand; targets: HallTarget[] } {
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y))
    throw new RangeError('Duplicate offset must be finite');
  const selected = effectiveTargets(draft, targets);
  const { snapshot } = draft;
  const destinationFloor = targetFloorId ? floorIdSchema.parse(targetFloorId) : null;
  const zoneIds = new Map<string, Zone['id']>();
  const rowIds = new Map<string, Row['id']>();
  const tableIds = new Map<string, Table['id']>();
  const patches: EditorPatch[] = [];
  const duplicated: HallTarget[] = [];
  const nextId = () => crypto.randomUUID();
  const zones = selected.filter((item) => item.kind === 'zone');
  const rows = selected.filter((item) => item.kind === 'row');
  const tables = selected.filter((item) => item.kind === 'table');
  const seats = selected.filter((item) => item.kind === 'seat');
  const decorations = selected.filter((item) => item.kind === 'decoration');

  for (const target of zones) {
    const zone = snapshot.zones.find((item) => item.id === target.id);
    if (!zone) continue;
    const id = zoneIdSchema.parse(`zone-${nextId()}`);
    zoneIds.set(zone.id, id);
    patches.push({
      collection: 'zones',
      id,
      before: null,
      after: {
        ...zone,
        id,
        floorId: destinationFloor ?? zone.floorId,
        name: `${zone.name} копия`,
        ...(zone.polygon
          ? { polygon: zone.polygon.map((point) => translated(point, offset)) }
          : {}),
      },
    });
    const bounds = draft.zoneBounds[zone.id];
    if (bounds)
      patches.push({
        collection: 'zoneBounds',
        id,
        before: null,
        after: {
          minX: bounds.minX + offset.x,
          maxX: bounds.maxX + offset.x,
          minY: bounds.minY + offset.y,
          maxY: bounds.maxY + offset.y,
        },
      });
    duplicated.push({ kind: 'zone', id });
  }
  const sourceRows = snapshot.rows.filter(
    (row) =>
      rows.some((target) => target.id === row.id) ||
      (row.zoneId && zoneIds.has(row.zoneId)),
  );
  for (const row of sourceRows) {
    const id = rowIdSchema.parse(`row-${nextId()}`);
    rowIds.set(row.id, id);
    patches.push({
      collection: 'rows',
      id,
      before: null,
      after: {
        ...translateRow(row, offset),
        id,
        floorId: destinationFloor ?? row.floorId,
        name: `${row.name} копия`,
        zoneId: row.zoneId && zoneIds.has(row.zoneId)
          ? zoneIds.get(row.zoneId)
          : destinationFloor && destinationFloor !== row.floorId ? undefined : row.zoneId,
      },
    });
    if (rows.some((target) => target.id === row.id))
      duplicated.push({ kind: 'row', id });
  }
  const sourceTables = snapshot.tables.filter(
    (table) =>
      tables.some((target) => target.id === table.id) ||
      (table.zoneId && zoneIds.has(table.zoneId)),
  );
  for (const table of sourceTables) {
    const id = tableIdSchema.parse(`table-${nextId()}`);
    tableIds.set(table.id, id);
    patches.push({
      collection: 'tables',
      id,
      before: null,
      after: {
        ...table,
        id,
        floorId: destinationFloor ?? table.floorId,
        label: `${table.label} копия`,
        center: translated(table.center, offset),
        zoneId: table.zoneId && zoneIds.has(table.zoneId)
          ? zoneIds.get(table.zoneId)
          : destinationFloor && destinationFloor !== table.floorId ? undefined : table.zoneId,
      },
    });
    if (tables.some((target) => target.id === table.id))
      duplicated.push({ kind: 'table', id });
  }
  const sourceSeats = snapshot.seats.filter(
    (seat) =>
      seats.some((target) => target.id === seat.id) ||
      (seat.zoneId && zoneIds.has(seat.zoneId)) ||
      (seat.placement.kind === 'row' && rowIds.has(seat.placement.rowId)) ||
      (seat.placement.kind === 'table' && tableIds.has(seat.placement.tableId)),
  );
  for (const seat of sourceSeats) {
    const id = seatIdSchema.parse(`seat-${nextId()}`);
    const placement: Seat['placement'] =
      seat.placement.kind === 'row' && rowIds.get(seat.placement.rowId)
        ? { kind: 'row', rowId: rowIds.get(seat.placement.rowId) as Row['id'] }
        : seat.placement.kind === 'table' &&
            tableIds.get(seat.placement.tableId)
          ? {
              kind: 'table',
              tableId: tableIds.get(seat.placement.tableId) as Table['id'],
            }
          : { kind: 'standalone' };
    const zoneId =
      seat.zoneId && zoneIds.has(seat.zoneId)
        ? zoneIds.get(seat.zoneId)
        : destinationFloor && destinationFloor !== seat.floorId ? undefined : seat.zoneId;
    patches.push({
      collection: 'seats',
      id,
      before: null,
      after: {
        ...seat,
        id,
        floorId: destinationFloor ?? seat.floorId,
        placement,
        position: translated(seat.position, offset),
        zoneId,
        ...(placement.kind === 'standalone'
          ? { slotKey: undefined, manual: undefined }
          : {}),
      },
    });
    if (seats.some((target) => target.id === seat.id))
      duplicated.push({ kind: 'seat', id });
  }
  for (const target of decorations) {
    const decoration = snapshot.decorations.find(
      (item) => item.id === target.id,
    );
    if (!decoration) continue;
    const id = decorationIdSchema.parse(`decoration-${nextId()}`);
    patches.push({
      collection: 'decorations',
      id,
      before: null,
      after:
        decoration.kind === 'label'
          ? {
              ...decoration,
              id,
              floorId: destinationFloor ?? decoration.floorId,
              position: translated(decoration.position, offset),
            }
          : {
              ...decoration,
              id,
              floorId: destinationFloor ?? decoration.floorId,
              polygon: decoration.polygon.map((point) =>
                translated(point, offset),
              ),
            },
    });
    duplicated.push({ kind: 'decoration', id });
  }
  return { command: { kind: 'create', patches }, targets: duplicated };
}

export function selectionCenterValue(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  axis: 'x' | 'y',
): number | null {
  const items = targetGeometry(draft, targets);
  if (items.length === 0) return null;
  const start = axis === 'x' ? 'minX' : 'minY';
  const end = axis === 'x' ? 'maxX' : 'maxY';
  const centers = items.map(({ bounds }) => (bounds[start] + bounds[end]) / 2);
  const first = centers[0];
  return first !== undefined &&
    centers.every((value) => Math.abs(value - first) < 0.000001)
    ? first
    : null;
}

export function setSelectionCenter(
  draft: HallLayoutDraft,
  targets: readonly HallTarget[],
  axis: 'x' | 'y',
  coordinate: number,
  publishedSeatIds: readonly Seat['id'][] = [],
): EditorCommand {
  if (!Number.isFinite(coordinate))
    throw new RangeError('Coordinate must be finite');
  const start = axis === 'x' ? 'minX' : 'minY';
  const end = axis === 'x' ? 'maxX' : 'maxY';
  return {
    kind: 'move',
    patches: uniquePatches(
      targetGeometry(draft, targets).map(({ target, bounds }) => {
        const current = (bounds[start] + bounds[end]) / 2;
        const delta = coordinate - current;
        return moveTarget(
          draft,
          target,
          axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta },
          publishedSeatIds,
        );
      }),
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

import {
  reconcileSeatIds,
  worldPointSchema,
  type Row,
  type Seat,
  type Table,
} from '@hall-platform/domain';
import {
  generateRowSeatSlots,
  generateTableSeatSlots,
  type RowSeatSlot,
  type TableSeatSlot,
} from '@hall-platform/geometry';
import type { EditorCommand, EditorPatch } from '../editorCommands.js';
import type { HallLayoutDraft } from '../editorDraft.js';

type Options = { readonly publishedSeatIds?: readonly Seat['id'][] };

export function preserveSeatManualAdjustment(before: Seat, after: Seat): Seat {
  if (before.placement.kind === 'standalone') return after;
  const offset = worldPointSchema.parse({
    x: (before.manual?.offset.x ?? 0) + after.position.x - before.position.x,
    y: (before.manual?.offset.y ?? 0) + after.position.y - before.position.y,
  });
  return {
    ...after,
    manual: {
      ...before.manual,
      offset,
      ...(after.label !== before.label ? { label: after.label } : {}),
    },
  };
}

function indexAttachedSeats(
  draft: HallLayoutDraft,
  kind: 'row' | 'table',
  id: string,
): { attached: Seat[]; allSeatIds: Seat['id'][] } {
  const attached: Seat[] = [];
  const allSeatIds: Seat['id'][] = [];
  for (const seat of draft.snapshot.seats) {
    allSeatIds.push(seat.id);
    if (
      (kind === 'row' &&
        seat.placement.kind === 'row' &&
        seat.placement.rowId === id) ||
      (kind === 'table' &&
        seat.placement.kind === 'table' &&
        seat.placement.tableId === id)
    )
      attached.push(seat);
  }
  return { attached, allSeatIds };
}

function seatPatches(
  previous: readonly Seat[],
  nextSlots: readonly (RowSeatSlot | TableSeatSlot)[],
  parent: Row | Table,
  kind: 'row' | 'table',
  oldSlots: readonly (RowSeatSlot | TableSeatSlot)[],
  options: Options,
  allSeatIds: readonly Seat['id'][],
): EditorPatch[] {
  const previousByKey = new Map(
    previous.map((seat, index) => [
      seat.slotKey ??
        (kind === 'row'
          ? String(index)
          : oldSlots[index] && 'slotKey' in oldSlots[index]
            ? oldSlots[index].slotKey
            : String(index)),
      seat,
    ]),
  );
  const oldSlotByKey = new Map(
    oldSlots.map((slot) => [
      kind === 'row'
        ? String(slot.slotIndex)
        : 'slotKey' in slot
          ? slot.slotKey
          : String(slot.slotIndex),
      slot,
    ]),
  );
  const keys = nextSlots.map((slot) =>
    kind === 'row'
      ? String(slot.slotIndex)
      : 'slotKey' in slot
        ? slot.slotKey
        : String(slot.slotIndex),
  );
  const matched = keys.map((key) => previousByKey.get(key) ?? null);
  const previousIds = previous.map((seat) => seat.id);
  const previousIdSet = new Set(previousIds);
  const reservedSeatIds = allSeatIds.filter((id) => !previousIdSet.has(id));
  const ids = reconcileSeatIds({
    previousSeatIds: previousIds,
    nextSeatIds: matched.map((seat) => seat?.id ?? null),
    reservedSeatIds,
    publishedSeatIds: options.publishedSeatIds ?? [],
  }).seatIds;

  const patches: EditorPatch[] = [];
  nextSlots.forEach((slot, index) => {
    const key = keys[index];
    const id = ids[index];
    if (key === undefined || id === undefined) return;
    const before = matched[index] ?? null;
    const oldBase = oldSlotByKey.get(key);
    const legacyOffset =
      before && !before.manual && oldBase
        ? {
            x: before.position.x - oldBase.position.x,
            y: before.position.y - oldBase.position.y,
          }
        : null;
    const manual =
      before?.manual ??
      (legacyOffset &&
      (legacyOffset.x !== 0 ||
        legacyOffset.y !== 0 ||
        before?.label !== oldBase?.label)
        ? {
            offset: worldPointSchema.parse(legacyOffset),
            ...(before?.label !== oldBase?.label
              ? { label: before?.label }
              : {}),
          }
        : undefined);
    const offset = manual?.offset ?? { x: 0, y: 0 };
    const position = worldPointSchema.parse({
      x: slot.position.x + offset.x,
      y: slot.position.y + offset.y,
    });
    const rotation =
      'rotationRadians' in slot
        ? slot.rotationRadians
        : slot.facingRadians - Math.PI / 2;
    const after: Seat = {
      id,
      floorId: parent.floorId,
      ...(parent.zoneId ? { zoneId: parent.zoneId } : {}),
      label: manual?.label ?? slot.label,
      position,
      placement:
        kind === 'row'
          ? { kind: 'row', rowId: parent.id as Row['id'] }
          : { kind: 'table', tableId: parent.id as Table['id'] },
      slotKey: key,
      ...(before?.visualKind ? { visualKind: before.visualKind } : {}),
      rotationRadians: rotation + (manual?.rotationOffsetRadians ?? 0),
      ...(manual ? { manual } : {}),
    };
    patches.push({ collection: 'seats', id, before, after });
  });
  const retained = new Set(ids);
  for (const seat of previous) {
    if (!retained.has(seat.id))
      patches.push({
        collection: 'seats',
        id: seat.id,
        before: seat,
        after: null,
      });
  }
  return patches;
}

function rowSlots(row: Row, fallbackCount: number) {
  return generateRowSeatSlots(
    row.curve,
    row.generation ?? { distribution: { kind: 'even', count: fallbackCount } },
  );
}

function tableSlots(table: Table) {
  return generateTableSeatSlots(table, table.generation ?? { seatOffset: 0.6 });
}

export function regenerateRowSeats(
  draft: HallLayoutDraft,
  before: Row | null,
  after: Row,
  options: Options = {},
): EditorCommand {
  const { attached: previous, allSeatIds } = indexAttachedSeats(
    draft,
    'row',
    before?.id ?? after.id,
  );
  const nextSlots = rowSlots(after, previous.length);
  const oldSlots =
    before && previous.length > 0 ? rowSlots(before, previous.length) : [];
  return {
    kind: before ? 'update' : 'create',
    patches: [
      { collection: 'rows', id: after.id, before, after },
      ...seatPatches(
        previous,
        nextSlots,
        after,
        'row',
        oldSlots,
        options,
        allSeatIds,
      ),
    ],
  };
}

export function regenerateTableSeats(
  draft: HallLayoutDraft,
  before: Table | null,
  after: Table,
  options: Options = {},
): EditorCommand {
  const { attached: previous, allSeatIds } = indexAttachedSeats(
    draft,
    'table',
    before?.id ?? after.id,
  );
  const nextSlots = tableSlots(after);
  const oldSlots = before && previous.length > 0 ? tableSlots(before) : [];
  return {
    kind: before ? 'update' : 'create',
    patches: [
      { collection: 'tables', id: after.id, before, after },
      ...seatPatches(
        previous,
        nextSlots,
        after,
        'table',
        oldSlots,
        options,
        allSeatIds,
      ),
    ],
  };
}

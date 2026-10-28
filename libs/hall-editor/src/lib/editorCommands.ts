import {
  decorationSchema,
  rowSchema,
  seatSchema,
  tableSchema,
  worldCalibrationSchema,
  zoneSchema,
  type Background,
  type Decoration,
  type Floor,
  type Row,
  type Seat,
  type Table,
  type Zone,
} from '@hall-platform/domain';
import type { SpatialBounds } from '@hall-platform/geometry';
import {
  parseHallLayoutDraft,
  type HallLayoutDraft,
  type PdfAsset,
} from './editorDraft.js';

export type EditorPatch = (
  | {
      collection: 'floors';
      id: string;
      before: Floor | null;
      after: Floor | null;
    }
  | {
      collection: 'decorations';
      id: string;
      before: Decoration | null;
      after: Decoration | null;
    }
  | { collection: 'zones'; id: string; before: Zone | null; after: Zone | null }
  | {
      collection: 'backgrounds';
      id: string;
      before: Background | null;
      after: Background | null;
    }
  | {
      collection: 'assets';
      id: string;
      before: PdfAsset | null;
      after: PdfAsset | null;
    }
  | {
      collection: 'calibration';
      before: HallLayoutDraft['calibration'];
      after: HallLayoutDraft['calibration'];
    }
  | { collection: 'rows'; id: string; before: Row | null; after: Row | null }
  | { collection: 'seats'; id: string; before: Seat | null; after: Seat | null }
  | {
      collection: 'tables';
      id: string;
      before: Table | null;
      after: Table | null;
    }
  | {
      collection: 'zoneBounds';
      id: string;
      before: SpatialBounds | null;
      after: SpatialBounds | null;
    }
) & { readonly index?: number };

export type EditorCommand = Readonly<{
  kind: 'create' | 'update' | 'delete' | 'move';
  patches: readonly EditorPatch[];
}>;

export type EditorState = Readonly<{
  draft: HallLayoutDraft;
  past: readonly EditorCommand[];
  future: readonly EditorCommand[];
}>;

export function createEditorState(draft: HallLayoutDraft): EditorState {
  return { draft, past: [], future: [] };
}

function replaceItem<T extends { id: string }>(
  items: readonly T[],
  id: string,
  after: T | null,
  index?: number,
): T[] {
  const existing = items.findIndex((item) => item.id === id);
  if (after === null) return items.filter((item) => item.id !== id);
  if (existing < 0) {
    if (index === undefined) return [...items, after];
    const next = [...items];
    next.splice(index, 0, after);
    return next;
  }
  return items.map((item) => (item.id === id ? after : item));
}

function replaceMovedItems<T extends { id: string }>(
  items: readonly T[],
  replacements: ReadonlyMap<string, T>,
): T[] {
  return items.map((item) => replacements.get(item.id) ?? item);
}

type IdentifiedPatch<T extends { id: string }> = Readonly<{
  id: string;
  before?: T | null;
  after: T | null;
  index?: number;
}>;

type SequenceNode<T> = {
  value: T;
  priority: number;
  size: number;
  left: SequenceNode<T> | null;
  right: SequenceNode<T> | null;
  parent: SequenceNode<T> | null;
};

function sequenceSize<T>(node: SequenceNode<T> | null): number {
  return node?.size ?? 0;
}

function updateSequenceNode<T>(node: SequenceNode<T>): void {
  node.size = 1 + sequenceSize(node.left) + sequenceSize(node.right);
  if (node.left) node.left.parent = node;
  if (node.right) node.right.parent = node;
}

function mergeSequence<T>(
  left: SequenceNode<T> | null,
  right: SequenceNode<T> | null,
): SequenceNode<T> | null {
  if (!left) {
    if (right) right.parent = null;
    return right;
  }
  if (!right) {
    left.parent = null;
    return left;
  }
  if (left.priority <= right.priority) {
    left.right = mergeSequence(left.right, right);
    updateSequenceNode(left);
    left.parent = null;
    return left;
  }
  right.left = mergeSequence(left, right.left);
  updateSequenceNode(right);
  right.parent = null;
  return right;
}

function splitSequence<T>(
  root: SequenceNode<T> | null,
  count: number,
): [SequenceNode<T> | null, SequenceNode<T> | null] {
  if (!root) return [null, null];
  if (count <= sequenceSize(root.left)) {
    const [left, middle] = splitSequence(root.left, count);
    root.left = middle;
    updateSequenceNode(root);
    root.parent = null;
    if (left) left.parent = null;
    return [left, root];
  }
  const [middle, right] = splitSequence(
    root.right,
    count - sequenceSize(root.left) - 1,
  );
  root.right = middle;
  updateSequenceNode(root);
  root.parent = null;
  if (right) right.parent = null;
  return [root, right];
}

function sequenceNodeRank<T>(node: SequenceNode<T>): number {
  let rank = sequenceSize(node.left);
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (parent.right === current) rank += sequenceSize(parent.left) + 1;
    current = parent;
  }
  return rank;
}

function insertSequenceNode<T>(
  root: SequenceNode<T> | null,
  node: SequenceNode<T>,
  index: number,
): SequenceNode<T> | null {
  const [left, right] = splitSequence(root, index);
  return mergeSequence(mergeSequence(left, node), right);
}

function removeSequenceNode<T>(
  root: SequenceNode<T> | null,
  node: SequenceNode<T>,
): SequenceNode<T> | null {
  const index = sequenceNodeRank(node);
  const [left, tail] = splitSequence(root, index);
  const [, right] = splitSequence(tail, 1);
  return mergeSequence(left, right);
}

function insertionIndex(index: number, length: number): number {
  if (Number.isNaN(index)) return 0;
  if (!Number.isFinite(index)) return index < 0 ? 0 : length;
  const integer = Math.trunc(index);
  return integer < 0
    ? Math.max(length + integer, 0)
    : Math.min(integer, length);
}

function sequencePriority(index: number): number {
  let value = (index + 1 + 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function applyStructuralArrayPatches<T extends { id: string }>(
  items: readonly T[],
  patches: readonly IdentifiedPatch<T>[],
): readonly T[] {
  if (patches.some((patch) => patch.after && patch.after.id !== patch.id)) {
    let next = items as T[];
    for (const patch of patches)
      next = replaceItem(next, patch.id, patch.after, patch.index);
    return next;
  }

  let root: SequenceNode<T> | null = null;
  const nodesById = new Map<string, SequenceNode<T>>();
  for (const item of items) {
    if (nodesById.has(item.id)) {
      let next = items as T[];
      for (const patch of patches)
        next = replaceItem(next, patch.id, patch.after, patch.index);
      return next;
    }
    const node: SequenceNode<T> = {
      value: item,
      priority: sequencePriority(nodesById.size),
      size: 1,
      left: null,
      right: null,
      parent: null,
    };
    root = mergeSequence(root, node);
    nodesById.set(item.id, node);
  }

  let nextPriority = items.length;
  for (const patch of patches) {
    const existing = nodesById.get(patch.id);
    if (patch.after === null) {
      if (!existing) continue;
      root = removeSequenceNode(root, existing);
      nodesById.delete(patch.id);
      continue;
    }
    if (existing) {
      existing.value = patch.after;
      continue;
    }
    const node: SequenceNode<T> = {
      value: patch.after,
      priority: sequencePriority(nextPriority++),
      size: 1,
      left: null,
      right: null,
      parent: null,
    };
    const index =
      patch.index === undefined
        ? sequenceSize(root)
        : insertionIndex(patch.index, sequenceSize(root));
    root = insertSequenceNode(root, node, index);
    nodesById.set(patch.id, node);
  }

  const result: T[] = [];
  const visit = (node: SequenceNode<T> | null) => {
    if (!node) return;
    visit(node.left);
    result.push(node.value);
    visit(node.right);
  };
  visit(root);
  return result;
}

function applyArrayPatches<T extends { id: string }>(
  items: readonly T[],
  patches: readonly IdentifiedPatch<T>[],
): readonly T[] {
  if (patches.length === 0) return items;
  if (patches.every((patch) => patch.after === null)) {
    const removed = new Set(patches.map((patch) => patch.id));
    return items.filter((item) => !removed.has(item.id));
  }

  if (
    patches.every(
      (patch) =>
        patch.before === null &&
        patch.after !== null &&
        patch.after.id === patch.id &&
        patch.index === undefined,
    )
  ) {
    const additions = new Map<string, T>();
    for (const patch of patches) {
      if (patch.after) additions.set(patch.id, patch.after);
    }
    const next: T[] = [];
    for (const item of items) {
      const replacement = additions.get(item.id);
      if (replacement) {
        next.push(replacement);
        additions.delete(item.id);
      } else next.push(item);
    }
    for (const patch of patches) {
      const addition = additions.get(patch.id);
      if (addition) {
        next.push(addition);
        additions.delete(patch.id);
      }
    }
    return next;
  }

  if (
    patches.every(
      (patch) =>
        patch.before !== null &&
        patch.before !== undefined &&
        patch.after !== null &&
        patch.before.id === patch.id &&
        patch.after.id === patch.id &&
        patch.index === undefined,
    )
  ) {
    const replacements = new Map<string, T>();
    for (const patch of patches) {
      if (patch.after) replacements.set(patch.id, patch.after);
    }
    const updated = items.map((item) => {
      const replacement = replacements.get(item.id);
      if (!replacement) return item;
      replacements.delete(item.id);
      return replacement;
    });
    if (replacements.size === 0) return updated;
  }

  return applyStructuralArrayPatches(items, patches);
}

function groupPatches(
  patches: readonly EditorPatch[],
): Map<EditorPatch['collection'], EditorPatch[]> {
  const groups = new Map<EditorPatch['collection'], EditorPatch[]>();
  for (const patch of patches) {
    const group = groups.get(patch.collection);
    if (group) group.push(patch);
    else groups.set(patch.collection, [patch]);
  }
  return groups;
}

function sameSeatPlacement(left: Seat, right: Seat): boolean {
  if (left.placement.kind !== right.placement.kind) return false;
  if (left.placement.kind === 'standalone') return true;
  if (left.placement.kind === 'row')
    return right.placement.kind === 'row' &&
      left.placement.rowId === right.placement.rowId;
  return right.placement.kind === 'table' &&
    left.placement.tableId === right.placement.tableId;
}

/** A move keeps the document graph intact, so only changed entities need parsing. */
function applyLocalMove(
  draft: HallLayoutDraft,
  patches: readonly EditorPatch[],
): HallLayoutDraft | null {
  const rows = new Map<string, Row>();
  const seats = new Map<string, Seat>();
  const tables = new Map<string, Table>();
  const zones = new Map<string, Zone>();
  const decorations = new Map<string, Decoration>();
  const zoneBounds = new Map<string, SpatialBounds>();
  let rowById: Map<string, Row> | undefined;
  let seatById: Map<string, Seat> | undefined;
  let tableById: Map<string, Table> | undefined;
  let zoneById: Map<string, Zone> | undefined;
  let decorationById: Map<string, Decoration> | undefined;

  for (const patch of patches) {
    if (patch.index !== undefined || patch.after === null) return null;
    switch (patch.collection) {
      case 'rows': {
        const before = (rowById ??= new Map(
          draft.snapshot.rows.map((row) => [row.id, row]),
        )).get(patch.id);
        if (!before || rows.has(patch.id) || patch.after.id !== patch.id ||
          before.floorId !== patch.after.floorId ||
          before.zoneId !== patch.after.zoneId) return null;
        const parsed = rowSchema.safeParse(patch.after);
        if (!parsed.success) throw parsed.error;
        rows.set(patch.id, patch.after);
        break;
      }
      case 'seats': {
        const before = (seatById ??= new Map(
          draft.snapshot.seats.map((seat) => [seat.id, seat]),
        )).get(patch.id);
        if (!before || seats.has(patch.id) || patch.after.id !== patch.id ||
          before.floorId !== patch.after.floorId ||
          before.zoneId !== patch.after.zoneId ||
          !sameSeatPlacement(before, patch.after)) return null;
        const parsed = seatSchema.safeParse(patch.after);
        if (!parsed.success) throw parsed.error;
        seats.set(patch.id, patch.after);
        break;
      }
      case 'tables': {
        const before = (tableById ??= new Map(
          draft.snapshot.tables.map((table) => [table.id, table]),
        )).get(patch.id);
        if (!before || tables.has(patch.id) || patch.after.id !== patch.id ||
          before.floorId !== patch.after.floorId ||
          before.zoneId !== patch.after.zoneId) return null;
        const parsed = tableSchema.safeParse(patch.after);
        if (!parsed.success) throw parsed.error;
        tables.set(patch.id, patch.after);
        break;
      }
      case 'zones': {
        const before = (zoneById ??= new Map(
          draft.snapshot.zones.map((zone) => [zone.id, zone]),
        )).get(patch.id);
        if (!before || zones.has(patch.id) || patch.after.id !== patch.id ||
          before.floorId !== patch.after.floorId) return null;
        const parsed = zoneSchema.safeParse(patch.after);
        if (!parsed.success) throw parsed.error;
        zones.set(patch.id, patch.after);
        break;
      }
      case 'decorations': {
        const before = (decorationById ??= new Map(
          draft.snapshot.decorations.map((item) => [item.id, item]),
        )).get(patch.id);
        if (!before || decorations.has(patch.id) ||
          patch.after.id !== patch.id ||
          before.floorId !== patch.after.floorId) return null;
        const parsed = decorationSchema.safeParse(patch.after);
        if (!parsed.success) throw parsed.error;
        decorations.set(patch.id, patch.after);
        break;
      }
      case 'zoneBounds': {
        const before = draft.zoneBounds[patch.id];
        if (!before || zoneBounds.has(patch.id)) return null;
        const bounds = patch.after;
        if (
          ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
          bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY
        ) throw new RangeError('Zone bounds must have positive finite dimensions');
        zoneBounds.set(patch.id, bounds);
        break;
      }
      default:
        return null;
    }
  }

  const snapshot = draft.snapshot;
  return {
    ...draft,
    snapshot: {
      ...snapshot,
      rows: rows.size ? replaceMovedItems(snapshot.rows, rows) : snapshot.rows,
      seats: seats.size ? replaceMovedItems(snapshot.seats, seats) : snapshot.seats,
      tables: tables.size ? replaceMovedItems(snapshot.tables, tables) : snapshot.tables,
      zones: zones.size ? replaceMovedItems(snapshot.zones, zones) : snapshot.zones,
      decorations: decorations.size
        ? replaceMovedItems(snapshot.decorations, decorations)
        : snapshot.decorations,
    },
    zoneBounds: zoneBounds.size
      ? { ...draft.zoneBounds, ...Object.fromEntries(zoneBounds) }
      : draft.zoneBounds,
  };
}

function applyPatches(
  draft: HallLayoutDraft,
  patches: readonly EditorPatch[],
): HallLayoutDraft {
  const grouped = groupPatches(patches);
  const patchesFor = (collection: EditorPatch['collection']) =>
    grouped.get(collection) ?? [];
  const snapshot = {
    ...draft.snapshot,
    floors: applyArrayPatches(
      draft.snapshot.floors,
      patchesFor('floors') as IdentifiedPatch<Floor>[],
    ),
    decorations: applyArrayPatches(
      draft.snapshot.decorations,
      patchesFor('decorations') as IdentifiedPatch<Decoration>[],
    ),
    zones: applyArrayPatches(
      draft.snapshot.zones,
      patchesFor('zones') as IdentifiedPatch<Zone>[],
    ),
    backgrounds: applyArrayPatches(
      draft.snapshot.backgrounds,
      patchesFor('backgrounds') as IdentifiedPatch<Background>[],
    ),
    rows: applyArrayPatches(
      draft.snapshot.rows,
      patchesFor('rows') as IdentifiedPatch<Row>[],
    ),
    seats: applyArrayPatches(
      draft.snapshot.seats,
      patchesFor('seats') as IdentifiedPatch<Seat>[],
    ),
    tables: applyArrayPatches(
      draft.snapshot.tables,
      patchesFor('tables') as IdentifiedPatch<Table>[],
    ),
  };
  let zoneBounds = draft.zoneBounds;
  let assets = draft.assets;
  let calibration = draft.calibration;
  const assetPatches = patchesFor('assets');
  if (assetPatches.length > 0) {
    const next = { ...assets };
    for (const patch of assetPatches) {
      if (patch.collection !== 'assets') continue;
      if (patch.after === null) delete next[patch.id];
      else next[patch.id] = patch.after;
    }
    assets = next;
  }
  const calibrationPatches = patchesFor('calibration');
  for (const patch of calibrationPatches) {
    if (patch.collection === 'calibration')
      calibration = patch.after
        ? worldCalibrationSchema.parse(patch.after)
        : null;
  }
  const boundsPatches = patchesFor('zoneBounds');
  if (boundsPatches.length > 0) {
    const next = { ...zoneBounds };
    for (const patch of boundsPatches) {
      if (patch.collection !== 'zoneBounds') continue;
      if (patch.after === null) delete next[patch.id];
      else next[patch.id] = patch.after;
    }
    zoneBounds = next;
  }

  const zoneIds = new Set<string>(
    snapshot.zones.map((zone) => zone.id),
  );
  for (const [id, bounds] of Object.entries(zoneBounds)) {
    if (
      !zoneIds.has(id) ||
      ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(
        Number.isFinite,
      ) ||
      bounds.minX >= bounds.maxX ||
      bounds.minY >= bounds.maxY
    ) {
      throw new RangeError(
        'Zone bounds must belong to a zone and have positive finite dimensions',
      );
    }
  }
  return parseHallLayoutDraft({
    ...draft,
    snapshot,
    zoneBounds,
    assets,
    calibration,
  });
}

function inverse(command: EditorCommand): EditorCommand {
  return {
    ...command,
    patches: [...command.patches].reverse().map((patch) => ({
      ...patch,
      before: patch.after,
      after: patch.before,
    })) as EditorPatch[],
  };
}

export function applyEditorCommand(
  state: EditorState,
  command: EditorCommand,
): EditorState {
  if (command.patches.length === 0) return state;
  const draft =
    (command.kind === 'move'
      ? applyLocalMove(state.draft, command.patches)
      : null) ?? applyPatches(state.draft, command.patches);
  return { draft, past: [...state.past, command].slice(-100), future: [] };
}

export function undoEditor(state: EditorState): EditorState {
  const command = state.past.at(-1);
  if (!command) return state;
  return {
    draft: (command.kind === 'move'
      ? applyLocalMove(state.draft, inverse(command).patches)
      : null) ?? applyPatches(state.draft, inverse(command).patches),
    past: state.past.slice(0, -1),
    future: [...state.future, command],
  };
}

export function redoEditor(state: EditorState): EditorState {
  const command = state.future.at(-1);
  if (!command) return state;
  return {
    draft: (command.kind === 'move'
      ? applyLocalMove(state.draft, command.patches)
      : null) ?? applyPatches(state.draft, command.patches),
    past: [...state.past, command],
    future: state.future.slice(0, -1),
  };
}

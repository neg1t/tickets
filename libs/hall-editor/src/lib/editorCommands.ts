import {
  decorationSchema,
  layoutSnapshotSchema,
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
  let snapshot = draft.snapshot;
  let zoneBounds = draft.zoneBounds;
  let assets = draft.assets;
  let calibration = draft.calibration;
  for (const patch of patches) {
    switch (patch.collection) {
      case 'floors':
        snapshot = {
          ...snapshot,
          floors: replaceItem(
            snapshot.floors,
            patch.id,
            patch.after,
            patch.index,
          ),
        };
        break;
      case 'decorations':
        snapshot = {
          ...snapshot,
          decorations: replaceItem(
            snapshot.decorations,
            patch.id,
            patch.after,
            patch.index,
          ),
        };
        break;
      case 'zones':
        snapshot = {
          ...snapshot,
          zones: replaceItem(
            snapshot.zones,
            patch.id,
            patch.after,
            patch.index,
          ),
        };
        break;
      case 'backgrounds':
        snapshot = {
          ...snapshot,
          backgrounds: replaceItem(
            snapshot.backgrounds,
            patch.id,
            patch.after,
            patch.index,
          ),
        };
        break;
      case 'assets': {
        const next = { ...assets };
        if (patch.after === null) delete next[patch.id];
        else next[patch.id] = patch.after;
        assets = next;
        break;
      }
      case 'calibration':
        calibration = patch.after
          ? worldCalibrationSchema.parse(patch.after)
          : null;
        break;
      case 'rows':
        snapshot = {
          ...snapshot,
          rows: replaceItem(snapshot.rows, patch.id, patch.after, patch.index),
        };
        break;
      case 'seats':
        snapshot = {
          ...snapshot,
          seats: replaceItem(
            snapshot.seats,
            patch.id,
            patch.after,
            patch.index,
          ),
        };
        break;
      case 'tables':
        snapshot = {
          ...snapshot,
          tables: replaceItem(
            snapshot.tables,
            patch.id,
            patch.after,
            patch.index,
          ),
        };
        break;
      case 'zoneBounds': {
        const next = { ...zoneBounds };
        if (patch.after === null) delete next[patch.id];
        else next[patch.id] = patch.after;
        zoneBounds = next;
        break;
      }
    }
  }
  const validatedSnapshot = layoutSnapshotSchema.parse(snapshot);
  const zoneIds = new Set<string>(
    validatedSnapshot.zones.map((zone) => zone.id),
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
    snapshot: validatedSnapshot,
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

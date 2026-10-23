import {
  layoutSnapshotSchema,
  worldCalibrationSchema,
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
  const draft = applyPatches(state.draft, command.patches);
  return { draft, past: [...state.past, command].slice(-100), future: [] };
}

export function undoEditor(state: EditorState): EditorState {
  const command = state.past.at(-1);
  if (!command) return state;
  return {
    draft: applyPatches(state.draft, inverse(command).patches),
    past: state.past.slice(0, -1),
    future: [...state.future, command],
  };
}

export function redoEditor(state: EditorState): EditorState {
  const command = state.future.at(-1);
  if (!command) return state;
  return {
    draft: applyPatches(state.draft, command.patches),
    past: [...state.past, command],
    future: state.future.slice(0, -1),
  };
}

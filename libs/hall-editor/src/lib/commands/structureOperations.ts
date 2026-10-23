import {
  decorationIdSchema,
  floorIdSchema,
  worldPointSchema,
  type Decoration,
  type Floor,
} from '@hall-platform/domain';
import type { Vector2 } from '@hall-platform/geometry';
import type { EditorCommand, EditorPatch } from '../editorCommands.js';
import type { HallLayoutDraft } from '../editorDraft.js';

export function createFloor(
  draft: HallLayoutDraft,
  name: string,
): EditorCommand {
  const floor: Floor = {
    id: floorIdSchema.parse(`floor-${crypto.randomUUID()}`),
    layoutVersionId: draft.snapshot.layoutVersionId,
    name: name.trim(),
  };
  return {
    kind: 'create',
    patches: [
      { collection: 'floors', id: floor.id, before: null, after: floor },
    ],
  };
}

export function renameFloor(before: Floor, name: string): EditorCommand {
  return {
    kind: 'update',
    patches: [
      {
        collection: 'floors',
        id: before.id,
        before,
        after: { ...before, name: name.trim() },
      },
    ],
  };
}

export function deleteFloor(
  draft: HallLayoutDraft,
  floorId: string,
): EditorCommand {
  if (draft.snapshot.floors.length <= 1)
    throw new Error('Нельзя удалить последний этаж');
  const floor = draft.snapshot.floors.find((item) => item.id === floorId);
  if (!floor) return { kind: 'delete', patches: [] };
  const patches: EditorPatch[] = [];
  for (const seat of draft.snapshot.seats
    .filter((item) => item.floorId === floorId)
    .reverse())
    patches.push({
      collection: 'seats',
      id: seat.id,
      before: seat,
      after: null,
      index: draft.snapshot.seats.indexOf(seat),
    });
  for (const row of draft.snapshot.rows
    .filter((item) => item.floorId === floorId)
    .reverse())
    patches.push({
      collection: 'rows',
      id: row.id,
      before: row,
      after: null,
      index: draft.snapshot.rows.indexOf(row),
    });
  for (const table of draft.snapshot.tables
    .filter((item) => item.floorId === floorId)
    .reverse())
    patches.push({
      collection: 'tables',
      id: table.id,
      before: table,
      after: null,
      index: draft.snapshot.tables.indexOf(table),
    });
  for (const decoration of draft.snapshot.decorations
    .filter((item) => item.floorId === floorId)
    .reverse())
    patches.push({
      collection: 'decorations',
      id: decoration.id,
      before: decoration,
      after: null,
      index: draft.snapshot.decorations.indexOf(decoration),
    });
  for (const background of draft.snapshot.backgrounds
    .filter((item) => item.floorId === floorId)
    .reverse())
    patches.push({
      collection: 'backgrounds',
      id: background.id,
      before: background,
      after: null,
      index: draft.snapshot.backgrounds.indexOf(background),
    });
  for (const zone of draft.snapshot.zones
    .filter((item) => item.floorId === floorId)
    .reverse()) {
    patches.push({
      collection: 'zones',
      id: zone.id,
      before: zone,
      after: null,
      index: draft.snapshot.zones.indexOf(zone),
    });
    const bounds = draft.zoneBounds[zone.id];
    if (bounds)
      patches.push({
        collection: 'zoneBounds',
        id: zone.id,
        before: bounds,
        after: null,
      });
  }
  patches.push({
    collection: 'floors',
    id: floor.id,
    before: floor,
    after: null,
    index: draft.snapshot.floors.indexOf(floor),
  });
  return { kind: 'delete', patches };
}

export function makeDecoration(
  draft: HallLayoutDraft,
  kind: Decoration['kind'],
  point: Vector2,
  floorId?: string,
): Decoration {
  const activeFloorId = floorId ?? draft.snapshot.floors[0]?.id;
  const floor = draft.snapshot.floors.find((item) => item.id === activeFloorId);
  if (!floor) throw new Error('Этаж не найден');
  const id = decorationIdSchema.parse(`decoration-${crypto.randomUUID()}`);
  if (kind === 'label') {
    return {
      id,
      floorId: floor.id,
      kind,
      position: worldPointSchema.parse(point),
      text: 'Подпись',
    };
  }
  const halfWidth = kind === 'stage' ? 4 : 1.5;
  const halfHeight = kind === 'stage' ? 2 : 1.5;
  return {
    id,
    floorId: floor.id,
    kind,
    polygon: [
      worldPointSchema.parse({
        x: point.x - halfWidth,
        y: point.y - halfHeight,
      }),
      worldPointSchema.parse({
        x: point.x + halfWidth,
        y: point.y - halfHeight,
      }),
      worldPointSchema.parse({
        x: point.x + halfWidth,
        y: point.y + halfHeight,
      }),
      worldPointSchema.parse({
        x: point.x - halfWidth,
        y: point.y + halfHeight,
      }),
    ],
    label: kind === 'stage' ? 'Сцена' : 'Препятствие',
  };
}

export function createDecoration(
  draft: HallLayoutDraft,
  kind: Decoration['kind'],
  point: Vector2,
  floorId?: string,
): EditorCommand {
  const decoration = makeDecoration(draft, kind, point, floorId);
  return {
    kind: 'create',
    patches: [
      {
        collection: 'decorations',
        id: decoration.id,
        before: null,
        after: decoration,
      },
    ],
  };
}

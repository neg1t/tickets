import type { SpatialBounds } from '@hall-platform/geometry';
import type { RendererSeatUpdate } from './rendererContract.js';
import type {
  RendererScene,
  RendererSceneIdentity,
  SceneItem,
} from './scene.js';

/**
 * A revision-checked scene transition. Geometry changes retain the full next
 * scene for hit testing while renderers update only the affected GPU blocks.
 */
export type RendererSceneChangeSet<TGeometry = unknown> = Readonly<{
  scene: RendererScene<TGeometry>;
  baseRevision: number;
  revision: number;
  identity?: RendererSceneIdentity;
  replace: boolean;
  orderChanged: boolean;
  added: readonly SceneItem<TGeometry>[];
  updated: readonly SceneItem<TGeometry>[];
  removed: readonly string[];
  removedSourceIds: readonly string[];
  styles: readonly RendererSeatUpdate[];
}>;

function equalBounds(first: SpatialBounds, second: SpatialBounds): boolean {
  return (
    first.minX === second.minX &&
    first.minY === second.minY &&
    first.maxX === second.maxX &&
    first.maxY === second.maxY
  );
}

function equalGeometryValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (
    first === null ||
    second === null ||
    typeof first !== 'object' ||
    typeof second !== 'object'
  )
    return false;
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const keys = Object.keys(firstRecord);
  if (keys.length !== Object.keys(secondRecord).length) return false;
  return keys.every((key) => {
    const firstValue = firstRecord[key];
    const secondValue = secondRecord[key];
    if (Object.is(firstValue, secondValue)) return true;
    if (
      firstValue === null ||
      secondValue === null ||
      typeof firstValue !== 'object' ||
      typeof secondValue !== 'object'
    )
      return false;
    const firstNested = firstValue as Record<string, unknown>;
    const secondNested = secondValue as Record<string, unknown>;
    const nestedKeys = Object.keys(firstNested);
    return (
      nestedKeys.length === Object.keys(secondNested).length &&
      nestedKeys.every((nestedKey) =>
        Object.is(firstNested[nestedKey], secondNested[nestedKey]),
      )
    );
  });
}

function sameIdentity(
  first: RendererSceneIdentity | undefined,
  second: RendererSceneIdentity | undefined,
): boolean {
  return (
    first?.documentId === second?.documentId &&
    first?.sessionId === second?.sessionId
  );
}

export function diffRendererScenes<TGeometry>(
  previous: RendererScene<TGeometry>,
  next: RendererScene<TGeometry>,
  styles: readonly RendererSeatUpdate[] = [],
): RendererSceneChangeSet<TGeometry> {
  const previousByKey = previous.itemByKey;
  const nextByKey = next.itemByKey;
  const added: SceneItem<TGeometry>[] = [];
  const updated: SceneItem<TGeometry>[] = [];
  const removed: string[] = [];
  let orderChanged = false;
  for (const [key, item] of nextByKey) {
    const oldItem = previousByKey.get(key);
    if (!oldItem) {
      added.push(item);
    } else if (
      !equalBounds(oldItem.bounds, item.bounds) ||
      !equalGeometryValue(oldItem.geometry, item.geometry)
    ) {
      updated.push(item);
    }
    if (oldItem && previous.itemOrder.get(oldItem) !== next.itemOrder.get(item))
      orderChanged = true;
  }
  for (const key of previousByKey.keys())
    if (!nextByKey.has(key)) removed.push(key);
  const nextSourceItemIds = new Set(next.sourceItemIds);
  const removedSourceIds = previous.sourceItemIds.filter(
    (id) => !nextSourceItemIds.has(id),
  );

  const replace =
    !sameIdentity(previous.identity, next.identity) ||
    previous.floorId !== next.floorId;
  return {
    scene: next,
    baseRevision: previous.revision,
    revision: next.revision,
    ...(next.identity !== undefined ? { identity: next.identity } : {}),
    replace,
    orderChanged,
    added,
    updated,
    removed,
    removedSourceIds,
    styles,
  };
}

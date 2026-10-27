import { SpatialIndex, type SpatialBounds } from '@hall-platform/geometry';

/** Immutable world-space geometry shared by every renderer implementation. */
export type SceneItem<TGeometry = unknown> = Readonly<{
  id: string;
  floorId: string;
  kind: string;
  bounds: SpatialBounds;
  geometry: TGeometry;
}>;

export type RendererScene<TGeometry = unknown> = Readonly<{
  revision: number;
  items: readonly SceneItem<TGeometry>[];
  itemByKey: ReadonlyMap<string, SceneItem<TGeometry>>;
  itemOrder: ReadonlyMap<SceneItem<TGeometry>, number>;
  index: SpatialIndex<SceneItem<TGeometry>>;
}>;

export function sceneItemKey(
  item: Pick<SceneItem, 'floorId' | 'kind' | 'id'>,
): string {
  return JSON.stringify([item.floorId, item.kind, item.id]);
}

export function createRendererScene<TGeometry>(
  revision: number,
  items: readonly SceneItem<TGeometry>[],
): RendererScene<TGeometry> {
  const itemByKey = new Map<string, SceneItem<TGeometry>>();
  const itemOrder = new Map<SceneItem<TGeometry>, number>();
  const index = new SpatialIndex<SceneItem<TGeometry>>(8);
  const stableItems = Object.freeze([...items]);
  stableItems.forEach((item, order) => {
    const key = sceneItemKey(item);
    if (itemByKey.has(key))
      throw new Error(`Duplicate renderer scene item: ${key}`);
    itemByKey.set(key, item);
    itemOrder.set(item, order);
    index.upsert(key, item.bounds, item);
  });
  return {
    revision,
    items: stableItems,
    itemByKey,
    itemOrder,
    index,
  };
}

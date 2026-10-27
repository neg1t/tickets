import { type SpatialBounds, type Vector2 } from '@hall-platform/geometry';
import type { RendererScene, SceneItem } from './scene.js';

export type SceneHitTestOptions<TGeometry = unknown> = Readonly<{
  floorId?: string;
  allowedKinds?: ReadonlySet<string>;
  kindPriority?: readonly string[];
  tolerance?: number;
  compareWithinKind?: (
    first: SceneItem<TGeometry>,
    second: SceneItem<TGeometry>,
  ) => number;
}>;

function queryBounds(point: Vector2, tolerance: number): SpatialBounds {
  return {
    minX: point.x - tolerance,
    minY: point.y - tolerance,
    maxX: point.x + tolerance,
    maxY: point.y + tolerance,
  };
}

/** Query shared scene geometry, then delegate shape-specific checks to the adapter. */
export function hitTestScene<TGeometry>(
  scene: RendererScene<TGeometry>,
  point: Vector2,
  containsPoint: (
    item: SceneItem<TGeometry>,
    point: Vector2,
    tolerance: number,
  ) => boolean,
  options: SceneHitTestOptions<TGeometry> = {},
): SceneItem<TGeometry> | null {
  const tolerance = Math.max(0, options.tolerance ?? 0);
  const priority = new Map(
    (options.kindPriority ?? []).map((kind, index) => [kind, index]),
  );
  const candidates = scene.index
    .search(queryBounds(point, tolerance))
    .map(({ value }) => value)
    .filter(
      (item) =>
        (!options.floorId || item.floorId === options.floorId) &&
        (!options.allowedKinds || options.allowedKinds.has(item.kind)),
    )
    .sort(
      (first, second) =>
        (priority.get(first.kind) ?? Number.MAX_SAFE_INTEGER) -
          (priority.get(second.kind) ?? Number.MAX_SAFE_INTEGER) ||
        (options.compareWithinKind?.(first, second) ?? 0) ||
        (scene.itemOrder.get(first) ?? 0) - (scene.itemOrder.get(second) ?? 0),
    );

  return (
    candidates.find((item) => containsPoint(item, point, tolerance)) ?? null
  );
}

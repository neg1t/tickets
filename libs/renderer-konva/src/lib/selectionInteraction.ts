import {
  applySelectionOperation,
  isSelectionTargetAllowed,
  type HallTarget,
  type SelectableKind,
  type SelectionOperation,
} from '@hall-platform/renderer-core';
import type { SpatialBounds } from '@hall-platform/geometry';
import type { HallScene } from './hallScene.js';

export function filterSelectableTargets(
  targets: readonly HallTarget[],
  selectableKinds?: readonly SelectableKind[],
): HallTarget[] {
  const allowedKinds =
    selectableKinds === undefined ? undefined : new Set(selectableKinds);
  return targets.filter((target) =>
    isSelectionTargetAllowed(target, allowedKinds),
  );
}

export function clickSelection(
  current: readonly HallTarget[],
  target: HallTarget | null,
  operation: SelectionOperation,
  selectableKinds?: readonly SelectableKind[],
): HallTarget[] {
  if (target === null) return applySelectionOperation(current, [], operation);
  if (!filterSelectableTargets([target], selectableKinds).length)
    return [...current];
  return applySelectionOperation(current, [target], operation);
}

export function mergeBoxSelection(
  current: readonly HallTarget[],
  picked: readonly HallTarget[],
  operation: SelectionOperation,
  selectableKinds?: readonly SelectableKind[],
): HallTarget[] {
  return applySelectionOperation(
    current,
    filterSelectableTargets(picked, selectableKinds),
    operation,
  );
}

export function boxSelectedTargetsForSelection(
  scene: HallScene,
  bounds: SpatialBounds,
  selectableKinds: readonly SelectableKind[],
): HallTarget[] {
  const allowedKinds = new Set<string>(selectableKinds);
  return scene.index.index
    .search(bounds)
    .flatMap(({ value: item, bounds: itemBounds }) => {
      if (!allowedKinds.has(item.kind)) return [];
      if (item.kind === 'seat') {
        const seat = scene.seatsById.get(item.id);
        if (!seat) return [];
        return seat.position.x >= bounds.minX &&
          seat.position.x <= bounds.maxX &&
          seat.position.y >= bounds.minY &&
          seat.position.y <= bounds.maxY
          ? [item.geometry]
          : [];
      }
      return itemBounds.minX >= bounds.minX &&
        itemBounds.maxX <= bounds.maxX &&
        itemBounds.minY >= bounds.minY &&
        itemBounds.maxY <= bounds.maxY
        ? [item.geometry]
        : [];
    });
}

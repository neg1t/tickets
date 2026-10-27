import {
  hitSeatSymbol,
  hitTestScene,
  type RendererScene,
  type RendererSeatGeometry,
  type RendererTargetRef,
  type SceneItem,
} from '@hall-platform/renderer-core';
import type { Vector2 } from '@hall-platform/geometry';

export function hitTestSeatScene(
  scene: RendererScene<RendererSeatGeometry>,
  point: Vector2,
  floorId: string | undefined = scene.floorId,
  tolerance = 0,
): RendererTargetRef | null {
  const hit = hitTestScene(
    scene,
    point,
    (item: SceneItem<RendererSeatGeometry>, hitPoint, hitTolerance) =>
      item.kind === 'seat' &&
      hitSeatSymbol(item.geometry, hitPoint, hitTolerance),
    {
      ...(floorId !== undefined ? { floorId } : {}),
      allowedKinds: new Set(['seat']),
      kindPriority: ['seat'],
      tolerance,
    },
  );
  return hit ? { kind: hit.kind, id: hit.id } : null;
}

import {
  worldToScreen,
  type RendererScene,
  type RendererSeatGeometry,
  type Viewport,
} from '@hall-platform/renderer-core';
import type { SpatialBounds } from '@hall-platform/geometry';

const minimumLabelScale = 14;
const maximumVisibleLabels = 2_000;

export function drawSeatLabels(
  context: CanvasRenderingContext2D,
  scene: RendererScene<RendererSeatGeometry>,
  labelsById: ReadonlyMap<string, string>,
  viewport: Viewport,
  width: number,
  height: number,
): number {
  if (viewport.scale < minimumLabelScale || labelsById.size === 0) return 0;
  const scale = Math.max(0.0001, viewport.scale);
  const visibleBounds: SpatialBounds = {
    minX: -viewport.x / scale,
    minY: -viewport.y / scale,
    maxX: (width - viewport.x) / scale,
    maxY: (height - viewport.y) / scale,
  };
  const visibleSeats = scene.index
    .search(visibleBounds)
    .map(({ value }) => value)
    .filter(
      (item) =>
        item.kind === 'seat' &&
        (!scene.floorId || item.floorId === scene.floorId) &&
        labelsById.has(item.id),
    )
    .sort(
      (first, second) =>
        (scene.itemOrder.get(first) ?? 0) - (scene.itemOrder.get(second) ?? 0),
    );
  if (visibleSeats.length === 0) return 0;

  const stride = Math.max(
    1,
    Math.ceil(visibleSeats.length / maximumVisibleLabels),
  );
  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  context.font = '10px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  context.fillStyle = '#fff';

  let rendered = 0;
  for (let index = 0; index < visibleSeats.length; index += stride) {
    const item = visibleSeats[index];
    if (!item) continue;
    const label = labelsById.get(item.id);
    if (!label) continue;
    const point = worldToScreen(viewport, item.geometry.position);
    context.strokeText(label, point.x, point.y, 30);
    context.fillText(label, point.x, point.y, 30);
    rendered += 1;
  }
  context.restore();
  return rendered;
}

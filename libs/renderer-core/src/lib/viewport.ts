import type { SpatialBounds, Vector2 } from '@hall-platform/geometry';

export type Viewport = Readonly<{
  x: number;
  y: number;
  scale: number;
  revision?: number;
}>;
export type CameraSnapshot = Readonly<{
  x: number;
  y: number;
  scale: number;
  revision: number;
}>;
export const defaultViewport: Viewport = { x: 0, y: 0, scale: 1 };

const minimumScale = 1e-12;
const maximumScale = 80;

export function screenToWorld(viewport: Viewport, point: Vector2): Vector2 {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function worldToScreen(viewport: Viewport, point: Vector2): Vector2 {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

export function zoomViewportAt(
  viewport: Viewport,
  anchor: Vector2,
  factor: number,
): Viewport {
  if (!Number.isFinite(factor) || factor <= 0) return viewport;
  const world = screenToWorld(viewport, anchor);
  const scale = Math.min(
    maximumScale,
    Math.max(minimumScale, viewport.scale * factor),
  );
  return {
    x: anchor.x - world.x * scale,
    y: anchor.y - world.y * scale,
    scale,
  };
}

export function panViewportBy(viewport: Viewport, delta: Vector2): Viewport {
  return { ...viewport, x: viewport.x + delta.x, y: viewport.y + delta.y };
}

export function resizeViewportPreservingCenter(
  viewport: Viewport,
  previousWidth: number,
  previousHeight: number,
  nextWidth: number,
  nextHeight: number,
): Viewport {
  const worldCenter = screenToWorld(viewport, {
    x: previousWidth / 2,
    y: previousHeight / 2,
  });
  return {
    ...viewport,
    x: nextWidth / 2 - worldCenter.x * viewport.scale,
    y: nextHeight / 2 - worldCenter.y * viewport.scale,
  };
}

export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  lineHeight = 16,
  pageHeight = 800,
): number {
  if (deltaMode === 1) return deltaY * lineHeight;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
  lineHeight: number,
  pageHeight: number,
): number {
  const sensitivity = ctrlKey ? 0.002 : 0.0015;
  return Math.exp(
    -normalizeWheelDelta(deltaY, deltaMode, lineHeight, pageHeight) *
      sensitivity,
  );
}

export function fitViewport(
  bounds: SpatialBounds,
  width: number,
  height: number,
  padding = 30,
): Viewport {
  const availableWidth = Math.max(1, width - 2 * padding);
  const availableHeight = Math.max(1, height - 2 * padding);
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fittedScale = Math.min(
    availableWidth / worldWidth,
    availableHeight / worldHeight,
  );
  const scale = Math.max(Number.MIN_VALUE, Math.min(maximumScale, fittedScale));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: width / 2 - centerX * scale,
    y: height / 2 - centerY * scale,
    scale,
  };
}

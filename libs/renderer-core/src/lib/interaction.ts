import type { Vector2 } from '@hall-platform/geometry';
import {
  panViewportBy,
  screenToWorld,
  zoomViewportAt,
  type Viewport,
} from './viewport.js';

export type PointerSession = Readonly<{
  pointerId: number;
  startScreen: Vector2;
  startWorld: Vector2;
  screen: Vector2;
  delta: Vector2;
  dragging: boolean;
}>;

export type PinchGesture = Readonly<{ center: Vector2; distance: number }>;

export function pinchGestureFromPointers(
  pointers: readonly Vector2[],
): PinchGesture | null {
  const first = pointers[0];
  const second = pointers[1];
  if (!first || !second) return null;
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  };
}

export function advancePinchViewport(
  viewport: Viewport,
  previous: PinchGesture,
  current: PinchGesture,
): Viewport {
  const panned = panViewportBy(viewport, {
    x: current.center.x - previous.center.x,
    y: current.center.y - previous.center.y,
  });
  return zoomViewportAt(
    panned,
    current.center,
    previous.distance > 0 ? current.distance / previous.distance : 1,
  );
}

export function beginPointerSession(
  pointerId: number,
  screen: Vector2,
  viewport: Viewport,
): PointerSession {
  return {
    pointerId,
    startScreen: screen,
    startWorld: screenToWorld(viewport, screen),
    screen,
    delta: { x: 0, y: 0 },
    dragging: false,
  };
}

export function advancePointerSession(
  session: PointerSession,
  screen: Vector2,
  viewport: Viewport,
  pointerId = session.pointerId,
): PointerSession {
  if (pointerId !== session.pointerId) return session;
  const world = screenToWorld(viewport, screen);
  return {
    ...session,
    screen,
    delta: {
      x: world.x - session.startWorld.x,
      y: world.y - session.startWorld.y,
    },
    dragging:
      session.dragging ||
      Math.hypot(
        screen.x - session.startScreen.x,
        screen.y - session.startScreen.y,
      ) > 3,
  };
}

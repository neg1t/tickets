import type { Vector2 } from '@hall-platform/geometry';
import { screenToWorld, type Viewport } from '../viewport.js';

export type PointerSession = Readonly<{
  pointerId: number;
  startScreen: Vector2;
  startWorld: Vector2;
  screen: Vector2;
  delta: Vector2;
  dragging: boolean;
}>;

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

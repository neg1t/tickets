import type { Vector2 } from '@hall-platform/geometry';
import type { RendererScene } from './scene.js';
import type { RendererSceneChangeSet } from './sceneChanges.js';
import type { Viewport } from './viewport.js';

export type RendererTargetRef = Readonly<{ kind: string; id: string }>;

export type RendererSeatGeometry = Readonly<{
  position: Vector2;
  rotationRadians?: number | undefined;
  visualKind?: 'chair' | 'armchair' | 'wheelchairBay' | undefined;
}>;

/** Dynamic state is sent separately so renderers can update styles without rebuilding geometry. */
export type RendererSeatUpdate = Readonly<{
  id: string;
  status: string;
  price?: number | null;
  label?: string;
  /** CSS hex or rgb() fill override used to match a host renderer palette. */
  fillColor?: string | null;
  /** CSS hex or rgb() stroke override used to match a host renderer palette. */
  strokeColor?: string | null;
}>;

export type RendererSeatPositionUpdate = Readonly<{
  id: string;
  position: Vector2;
}>;

export type RendererEvent =
  | Readonly<{
      type: 'pick';
      target: RendererTargetRef;
      world: Vector2;
    }>
  | Readonly<{
      type: 'hover';
      target: RendererTargetRef | null;
      world: Vector2 | null;
    }>;

export type RendererContract<TGeometry = unknown> = Readonly<{
  setScene(scene: RendererScene<TGeometry>): boolean;
  /** Apply a same-document, same-floor geometry change against its base revision. */
  applySceneChanges(changes: RendererSceneChangeSet<TGeometry>): boolean;
  updateSeats(updates: readonly RendererSeatUpdate[]): void;
  setPreviewPositions(positions: readonly RendererSeatPositionUpdate[]): void;
  setViewport(viewport: Viewport): void;
  setSelection(targets: readonly RendererTargetRef[]): void;
  resize(width: number, height: number, pixelRatio?: number): void;
  setEventHandler(handler: ((event: RendererEvent) => void) | null): void;
  dispose(): void;
}>;

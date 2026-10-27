import type { Vector2 } from '@hall-platform/geometry';
import type { RendererScene } from './scene.js';
import type { Viewport } from './viewport.js';

export type RendererTargetRef = Readonly<{ kind: string; id: string }>;

/** Dynamic state is sent separately so renderers can update styles without rebuilding geometry. */
export type RendererSeatUpdate = Readonly<{
  id: string;
  status: string;
  price?: number | null;
  label?: string;
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
  setScene(scene: RendererScene<TGeometry>): void;
  updateSeats(updates: readonly RendererSeatUpdate[]): void;
  setViewport(viewport: Viewport): void;
  setSelection(targets: readonly RendererTargetRef[]): void;
  resize(width: number, height: number, pixelRatio?: number): void;
  setEventHandler(handler: ((event: RendererEvent) => void) | null): void;
  dispose(): void;
}>;

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createSeatScene,
  type RendererScene,
  type RendererSceneIdentity,
  type RendererSeatGeometry,
} from '@hall-platform/renderer-core';
import { WebGLHallCanvas } from '@hall-platform/renderer-webgl';

type HarnessState = {
  root: Root;
  identity: RendererSceneIdentity;
  updates: readonly { id: string; status: string }[];
  scene: RendererScene<RendererSeatGeometry> | null;
};

type HarnessWindow = Window & {
  __webglIncrementalSceneHarness?: HarnessState;
  __webglIncrementalSceneCanvas?: HTMLCanvasElement | null;
};

function renderScene(root: Root, revision: number, moved = false): void {
  const state = (window as HarnessWindow).__webglIncrementalSceneHarness;
  if (!state) throw new Error('Incremental scene harness is not mounted');
  const scene = createSeatScene(
    revision,
    Array.from({ length: 1_000 }, (_, index) => ({
      id: `incremental-seat-${index}`,
      floorId: 'main',
      position: {
        x: moved && index === 0 ? 10 : (index % 50) * 3,
        y: Math.floor(index / 50) * 3,
      },
    })),
    'main',
    state.identity,
  );
  state.scene = scene;
  root.render(
    createElement(WebGLHallCanvas, {
      scene,
      viewport: { x: 320, y: 240, scale: 10 },
      seatUpdates: state.updates,
    }),
  );
}

export function mountWebGLIncrementalSceneHarness(container: HTMLElement): {
  supported: boolean;
} {
  container.replaceChildren();
  container.style.width = '640px';
  container.style.height = '480px';
  if (!document.createElement('canvas').getContext('webgl2'))
    return { supported: false };
  const root = createRoot(container);
  const state = {
    root,
    identity: { documentId: 'incremental-test-doc', sessionId: 'session-1' },
    updates: Array.from({ length: 1_000 }, (_, index) => ({
      id: `incremental-seat-${index}`,
      status: 'available',
    })),
    scene: null,
  };
  (window as HarnessWindow).__webglIncrementalSceneHarness = state;
  renderScene(root, 1);
  return { supported: true };
}

export function moveWebGLIncrementalTestSeat(): void {
  const state = (window as HarnessWindow).__webglIncrementalSceneHarness;
  if (!state) throw new Error('Incremental scene harness is not mounted');
  renderScene(state.root, 2, true);
}

export function updateWebGLIncrementalTestAvailability(count: number): void {
  const state = (window as HarnessWindow).__webglIncrementalSceneHarness;
  if (!state) throw new Error('Incremental scene harness is not mounted');
  const updatedCount = Math.max(0, Math.min(1_000, count));
  state.updates = Array.from({ length: 1_000 }, (_, index) => ({
    id: `incremental-seat-${index}`,
    status: index < updatedCount ? 'sold' : 'available',
  }));
  if (!state.scene) throw new Error('Incremental scene is not available');
  state.root.render(
    createElement(WebGLHallCanvas, {
      scene: state.scene,
      viewport: { x: 320, y: 240, scale: 10 },
      seatUpdates: state.updates,
    }),
  );
}

export function rememberWebGLIncrementalSceneCanvas(): void {
  (window as HarnessWindow).__webglIncrementalSceneCanvas =
    document.querySelector<HTMLCanvasElement>('canvas[data-renderer="webgl2"]');
}

export function isWebGLIncrementalSceneCanvasStable(): boolean {
  const state = window as HarnessWindow;
  return (
    state.__webglIncrementalSceneCanvas ===
    document.querySelector<HTMLCanvasElement>('canvas[data-renderer="webgl2"]')
  );
}

export function unmountWebGLIncrementalSceneHarness(
  container: HTMLElement,
): void {
  const state = window as HarnessWindow;
  state.__webglIncrementalSceneHarness?.root.unmount();
  delete state.__webglIncrementalSceneHarness;
  delete state.__webglIncrementalSceneCanvas;
  container.replaceChildren();
}

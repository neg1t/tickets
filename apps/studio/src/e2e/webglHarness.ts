import {
  createSeatScene,
  type RendererEvent,
} from '@hall-platform/renderer-core';
import { WebGLHallRenderer } from '@hall-platform/renderer-webgl';

type WebGLTestWindow = Window & {
  __webglTestRenderer?: WebGLHallRenderer;
  __webglTestEvents?: RendererEvent[];
};

export function mountWebGLTestHarness(container: HTMLElement): {
  supported: boolean;
  message?: string;
} {
  const canvas = document.createElement('canvas');
  canvas.dataset.webglTestCanvas = 'true';
  canvas.style.display = 'block';
  canvas.style.width = '640px';
  canvas.style.height = '480px';
  container.append(canvas);

  try {
    const renderer = new WebGLHallRenderer(canvas, {
      preserveDrawingBuffer: true,
    });
    renderer.resize(640, 480, 1);
    renderer.setScene(
      createSeatScene(1, [
        {
          id: 'webgl-seat-center',
          floorId: 'main',
          position: { x: 0, y: 0 },
        },
        {
          id: 'webgl-seat-next',
          floorId: 'main',
          position: { x: 2, y: 0 },
          visualKind: 'armchair',
        },
      ]),
    );
    renderer.setViewport({ x: 320, y: 240, scale: 100 });
    const testWindow = window as WebGLTestWindow;
    testWindow.__webglTestRenderer = renderer;
    testWindow.__webglTestEvents = [];
    renderer.setEventHandler((event) =>
      testWindow.__webglTestEvents?.push(event),
    );
    return { supported: true };
  } catch (error) {
    return {
      supported: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

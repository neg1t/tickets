import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createSeatScene,
  type RendererEvent,
} from '@hall-platform/renderer-core';
import {
  WebGLHallCanvas,
  WebGLHallRenderer,
} from '@hall-platform/renderer-webgl';

type WebGLBenchmarkMetrics = Readonly<{
  seatCount: number;
  fixtureMs: number;
  sceneBuildMs: number;
  rendererSetupMs: number;
  firstFrameMs: number;
  drawCalls: number;
  visibleInstances: number;
  singleStatusBytes: number;
  singleStatusCalls: number;
  bulkStatusBytes: number;
  bulkStatusCalls: number;
  bulkStatusCpuMs: number;
  renderer: string;
}>;

type WebGLTestWindow = Window & {
  __webglTestRenderer?: WebGLHallRenderer;
  __webglTestEvents?: RendererEvent[];
  __webglBenchmarkMetrics?: WebGLBenchmarkMetrics;
  __webglReactRoot?: Root;
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

export async function mountWebGLPerformanceHarness(
  container: HTMLElement,
  seatCount: number,
): Promise<{ supported: boolean; metrics?: WebGLBenchmarkMetrics }> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  canvas.style.width = '640px';
  canvas.style.height = '480px';
  container.replaceChildren(canvas);

  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return { supported: false };
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : 'renderer details unavailable';

  let drawCalls = 0;
  let visibleInstances = 0;
  let bufferSubDataBytes = 0;
  let bufferSubDataCalls = 0;
  const drawArraysInstanced = gl.drawArraysInstanced.bind(gl);
  const bufferSubData = gl.bufferSubData.bind(gl);
  gl.drawArraysInstanced = (mode, first, vertexCount, instanceCount) => {
    drawCalls += 1;
    visibleInstances += instanceCount;
    drawArraysInstanced(mode, first, vertexCount, instanceCount);
  };
  gl.bufferSubData = ((target: number, offset: number, data: BufferSource) => {
    bufferSubDataCalls += 1;
    bufferSubDataBytes += ArrayBuffer.isView(data)
      ? data.byteLength
      : data instanceof ArrayBuffer
        ? data.byteLength
        : 0;
    bufferSubData(target, offset, data);
  }) as typeof gl.bufferSubData;

  const fixtureStarted = performance.now();
  const seats = Array.from({ length: seatCount }, (_, index) => ({
    id: `webgl-bench-${index}`,
    floorId: 'main',
    position: {
      x: (index % 200) * 2,
      y: Math.floor(index / 200) * 2,
    },
    ...(index % 100 === 0 ? { visualKind: 'wheelchairBay' as const } : {}),
  }));
  const fixtureMs = performance.now() - fixtureStarted;

  const sceneStarted = performance.now();
  const scene = createSeatScene(1, seats, 'main');
  const sceneBuildMs = performance.now() - sceneStarted;

  const rendererStarted = performance.now();
  const renderer = new WebGLHallRenderer(canvas, {
    preserveDrawingBuffer: true,
  });
  renderer.resize(640, 480, 1);
  renderer.setScene(scene);
  renderer.setViewport({ x: 0, y: 0, scale: 1.5 });
  const rendererSetupMs = performance.now() - rendererStarted;
  const firstFrameStarted = performance.now();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const firstFrameMs =
    Math.round((performance.now() - firstFrameStarted) * 100) / 100;
  const drawCallsAtFirstFrame = drawCalls;
  const visibleInstancesAtFirstFrame = visibleInstances;

  const singleBytesBefore = bufferSubDataBytes;
  const singleCallsBefore = bufferSubDataCalls;
  renderer.updateSeats([{ id: 'webgl-bench-0', status: 'sold' }]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const singleStatusBytes = bufferSubDataBytes - singleBytesBefore;
  const singleStatusCalls = bufferSubDataCalls - singleCallsBefore;

  const alternatingUpdates = seats.map(({ id }, index) => ({
    id,
    status: index % 2 === 0 ? 'sold' : 'available',
  }));
  const bulkBytesBefore = bufferSubDataBytes;
  const bulkCallsBefore = bufferSubDataCalls;
  const bulkStarted = performance.now();
  renderer.updateSeats(alternatingUpdates);
  const bulkStatusCpuMs =
    Math.round((performance.now() - bulkStarted) * 100) / 100;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const bulkStatusBytes = bufferSubDataBytes - bulkBytesBefore;
  const bulkStatusCalls = bufferSubDataCalls - bulkCallsBefore;
  const metrics: WebGLBenchmarkMetrics = {
    seatCount,
    fixtureMs: Math.round(fixtureMs * 100) / 100,
    sceneBuildMs: Math.round(sceneBuildMs * 100) / 100,
    rendererSetupMs: Math.round(rendererSetupMs * 100) / 100,
    firstFrameMs,
    drawCalls: drawCallsAtFirstFrame,
    visibleInstances: visibleInstancesAtFirstFrame,
    singleStatusBytes,
    singleStatusCalls,
    bulkStatusBytes,
    bulkStatusCalls,
    bulkStatusCpuMs,
    renderer: rendererName,
  };
  const testWindow = window as WebGLTestWindow;
  testWindow.__webglTestRenderer = renderer;
  testWindow.__webglBenchmarkMetrics = metrics;
  return { supported: true, metrics };
}

export function unmountWebGLPerformanceHarness(container: HTMLElement): void {
  const testWindow = window as WebGLTestWindow;
  testWindow.__webglTestRenderer?.dispose();
  delete testWindow.__webglTestRenderer;
  delete testWindow.__webglBenchmarkMetrics;
  container.replaceChildren();
}

export function mountWebGLLabelsHarness(container: HTMLElement): void {
  container.replaceChildren();
  container.style.width = '640px';
  container.style.height = '480px';
  const root = createRoot(container);
  const scene = createSeatScene(1, [
    { id: 'webgl-label-seat', floorId: 'main', position: { x: 0, y: 0 } },
  ]);
  root.render(
    createElement(WebGLHallCanvas, {
      scene,
      viewport: { x: 320, y: 240, scale: 20 },
      seatUpdates: [
        { id: 'webgl-label-seat', status: 'available', label: 'A1' },
      ],
    }),
  );
  (window as WebGLTestWindow).__webglReactRoot = root;
}

export function unmountWebGLLabelsHarness(container: HTMLElement): void {
  const testWindow = window as WebGLTestWindow;
  testWindow.__webglReactRoot?.unmount();
  delete testWindow.__webglReactRoot;
  container.replaceChildren();
}

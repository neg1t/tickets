import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererScene,
  type RendererSeatGeometry,
} from '@hall-platform/renderer-core';
import { WebGLHallRenderer } from './WebGLHallRenderer.js';

let frames: FrameRequestCallback[];
let documentHidden: boolean;
let mockDocument: Document;

function fakeContext(): WebGL2RenderingContext {
  const locations = new Map<string, number>();
  const nextLocation = (name: string) => {
    const current = locations.get(name) ?? locations.size;
    locations.set(name, current);
    return current;
  };
  return {
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    FLOAT: 5126,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    COLOR_BUFFER_BIT: 16384,
    TRIANGLES: 4,
    createShader: vi.fn(() => ({}) as WebGLShader),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({}) as WebGLProgram),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    getUniformLocation: vi.fn(() => ({}) as WebGLUniformLocation),
    getAttribLocation: vi.fn((_program, name: string) => nextLocation(name)),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({}) as WebGLBuffer),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    deleteBuffer: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    vertexAttribDivisor: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    drawArraysInstanced: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}

function seatScene() {
  return createRendererScene<RendererSeatGeometry>(1, [
    {
      id: 'seat-a',
      floorId: 'main',
      kind: 'seat',
      bounds: { minX: -0.8, minY: -0.8, maxX: 0.8, maxY: 0.8 },
      geometry: { position: { x: 0, y: 0 } },
    },
    {
      id: 'seat-offscreen',
      floorId: 'main',
      kind: 'seat',
      bounds: { minX: 999.2, minY: -0.8, maxX: 1000.8, maxY: 0.8 },
      geometry: { position: { x: 1000, y: 0 } },
    },
    {
      id: 'seat-b',
      floorId: 'main',
      kind: 'seat',
      bounds: { minX: 1.2, minY: -0.8, maxX: 2.8, maxY: 0.8 },
      geometry: { position: { x: 2, y: 0 } },
    },
  ]);
}

describe('WebGL hall renderer contract', () => {
  beforeEach(() => {
    frames = [];
    documentHidden = false;
    mockDocument = new EventTarget() as Document;
    Object.defineProperty(mockDocument, 'hidden', {
      configurable: true,
      get: () => documentHidden,
    });
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it('draws instances and uploads only changed status and selection ranges', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    renderer.resize(640, 480, 1);
    renderer.setScene(seatScene());
    const fullUploadsBeforeUpdates = vi.mocked(gl.bufferData).mock.calls.length;
    vi.mocked(gl.bufferSubData).mockClear();

    renderer.updateSeats([{ id: 'seat-b', status: 'sold', price: 40 }]);
    renderer.setSelection([{ kind: 'seat', id: 'seat-a' }]);
    renderer.setViewport({ x: 20, y: 10, scale: 2 });
    frames.splice(0).forEach((frame) => frame(16));

    expect(gl.bufferSubData).toHaveBeenCalledTimes(2);
    expect(gl.bufferSubData).toHaveBeenNthCalledWith(
      1,
      gl.ARRAY_BUFFER,
      2 * Float32Array.BYTES_PER_ELEMENT,
      new Float32Array([2]),
    );
    expect(gl.bufferSubData).toHaveBeenNthCalledWith(
      2,
      gl.ARRAY_BUFFER,
      0,
      new Float32Array([1]),
    );
    expect(gl.bufferData).toHaveBeenCalledTimes(fullUploadsBeforeUpdates);
    expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(2);
    expect(gl.drawArraysInstanced).toHaveBeenNthCalledWith(
      1,
      gl.TRIANGLES,
      0,
      6,
      1,
    );
    expect(gl.drawArraysInstanced).toHaveBeenNthCalledWith(
      2,
      gl.TRIANGLES,
      0,
      6,
      1,
    );
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(
      4,
      1,
      gl.FLOAT,
      false,
      0,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );

    renderer.dispose();
  });

  it('reports a failure when the context cannot restore its shaders', () => {
    const gl = fakeContext();
    const onError = vi.fn();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target, { onError });
    renderer.setScene(seatScene());
    vi.mocked(gl.createShader).mockReturnValueOnce(null);

    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    target.dispatchEvent(new Event('webglcontextrestored'));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Unable to allocate WebGL shader',
      }),
    );
    renderer.dispose();
  });

  it('moves preview seats in GPU buffers and restores their base positions', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    renderer.setScene(seatScene());
    vi.mocked(gl.bufferSubData).mockClear();
    const uploadedPositions: number[][] = [];
    vi.mocked(gl.bufferSubData).mockImplementation((_target, _offset, data) => {
      uploadedPositions.push(Array.from(data as Float32Array));
    });

    renderer.setPreviewPositions([
      { id: 'seat-a', position: { x: 10, y: 20 } },
    ]);
    renderer.setPreviewPositions([]);

    expect(uploadedPositions).toEqual([
      [10, 20],
      [0, 0],
    ]);
    renderer.dispose();
  });

  it('pauses pending frames in the background and resumes on return', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    renderer.setScene(seatScene());
    expect(frames).toHaveLength(1);

    documentHidden = true;
    mockDocument.dispatchEvent(new Event('visibilitychange'));
    renderer.setViewport({ x: 5, y: 10, scale: 2 });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(frames).toHaveLength(1);

    documentHidden = false;
    mockDocument.dispatchEvent(new Event('visibilitychange'));

    expect(frames).toHaveLength(2);
    renderer.dispose();
  });
});

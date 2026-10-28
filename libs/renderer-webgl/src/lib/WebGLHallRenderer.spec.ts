import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererScene,
  diffRendererScenes,
  type RendererSeatGeometry,
} from '@hall-platform/renderer-core';
import { SpatialIndex } from '@hall-platform/geometry';
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
    UNSIGNED_BYTE: 5121,
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
    uniform4f: vi.fn(),
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
    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(
      7,
      4,
      gl.UNSIGNED_BYTE,
      true,
      0,
      2 * Uint8Array.BYTES_PER_ELEMENT * 4,
    );

    renderer.dispose();
  });

  it('uses the resolved theme selection color for selected seats', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    renderer.setSelectedColor('#123456');
    renderer.resize(640, 480, 1);
    renderer.setScene(seatScene());
    renderer.setSelection([{ kind: 'seat', id: 'seat-a' }]);
    frames.splice(0).forEach((frame) => frame(16));

    expect(gl.uniform4f).toHaveBeenCalledWith(
      expect.anything(),
      18 / 255,
      52 / 255,
      86 / 255,
      1,
    );
    target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    target.dispatchEvent(new Event('webglcontextrestored'));
    frames.splice(0).forEach((frame) => frame(32));
    expect(gl.uniform4f).toHaveBeenLastCalledWith(
      expect.anything(),
      18 / 255,
      52 / 255,
      86 / 255,
      1,
    );
    renderer.dispose();
  });

  it('uploads host stroke colors as a separate partial instance range', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    renderer.setScene(seatScene());
    vi.mocked(gl.bufferSubData).mockClear();

    renderer.updateSeats([
      { id: 'seat-b', status: 'available', strokeColor: '#145577' },
    ]);

    expect(gl.bufferSubData).toHaveBeenCalledWith(
      gl.ARRAY_BUFFER,
      8,
      new Uint8Array([20, 85, 119, 255]),
    );
    renderer.dispose();
  });

  it('reuses visible seat ranges while the viewport stays inside its cached bounds', () => {
    const search = vi.spyOn(SpatialIndex.prototype, 'search');
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    renderer.resize(640, 480, 1);
    renderer.setScene(seatScene());
    frames.splice(0).forEach((frame) => frame(16));
    expect(search).toHaveBeenCalledTimes(1);

    renderer.setViewport({ x: 100, y: 40, scale: 1 });
    frames.splice(0).forEach((frame) => frame(32));
    expect(search).toHaveBeenCalledTimes(1);

    renderer.setViewport({ x: -5_000, y: 0, scale: 1 });
    frames.splice(0).forEach((frame) => frame(48));
    expect(search).toHaveBeenCalledTimes(2);
    renderer.dispose();
    search.mockRestore();
  });

  it('draws mixed seat symbols in one scene-order instanced range', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    const symbols = [
      { id: 'chair', visualKind: 'chair' },
      { id: 'armchair', visualKind: 'armchair' },
      { id: 'wheelchair', visualKind: 'wheelchairBay' },
    ] as const;
    renderer.resize(640, 480, 1);
    renderer.setScene(
      createRendererScene<RendererSeatGeometry>(
        1,
        symbols.map(({ id, visualKind }, index) => ({
          id,
          floorId: 'main',
          kind: 'seat' as const,
          bounds: {
            minX: index * 2 - 1,
            minY: -1,
            maxX: index * 2 + 1,
            maxY: 1,
          },
          geometry: { position: { x: index * 2, y: 0 }, visualKind },
        })),
      ),
    );
    renderer.setViewport({ x: 40, y: 40, scale: 1 });
    frames.splice(0).forEach((frame) => frame(16));

    expect(gl.vertexAttribPointer).toHaveBeenCalledWith(
      3,
      1,
      gl.FLOAT,
      false,
      0,
      0,
    );
    expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(1);
    expect(gl.drawArraysInstanced).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6, 3);

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

  it('signals only after a frame has drawn', () => {
    const gl = fakeContext();
    const onFrameRendered = vi.fn();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target, { onFrameRendered });
    renderer.resize(640, 480, 1);

    frames.splice(0).forEach((frame) => frame(8));
    expect(onFrameRendered).not.toHaveBeenCalled();
    renderer.setScene(seatScene());

    expect(onFrameRendered).not.toHaveBeenCalled();
    frames.splice(0).forEach((frame) => frame(16));

    expect(gl.drawArraysInstanced).toHaveBeenCalled();
    expect(onFrameRendered).toHaveBeenCalledTimes(1);
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
    renderer.setViewport({ x: 0, y: 0, scale: 10 });
    vi.mocked(gl.bufferSubData).mockClear();
    const uploadedPositions: number[][] = [];
    vi.mocked(gl.bufferSubData).mockImplementation((_target, _offset, data) => {
      uploadedPositions.push(Array.from(data as Float32Array));
    });

    renderer.setPreviewPositions([
      { id: 'seat-a', position: { x: 10, y: 20 } },
    ]);
    expect(renderer.pickAt({ x: 100, y: 200 })).toEqual({
      kind: 'seat',
      id: 'seat-a',
    });
    expect(renderer.pickAt({ x: 0, y: 0 })).toBeNull();
    renderer.setPreviewPositions([]);
    expect(renderer.pickAt({ x: 0, y: 0 })).toEqual({
      kind: 'seat',
      id: 'seat-a',
    });

    expect(uploadedPositions).toEqual([
      [10, 20],
      [0, 0],
    ]);
    renderer.dispose();
  });

  it('updates one moved seat in place without rebuilding scene buffers', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    const identity = { documentId: 'doc-1', sessionId: 'session-1' } as const;
    const previous = createRendererScene<RendererSeatGeometry>(
      1,
      [
        {
          id: 'seat-a',
          floorId: 'main',
          kind: 'seat',
          bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
          geometry: { position: { x: 0, y: 0 } },
        },
        {
          id: 'seat-b',
          floorId: 'main',
          kind: 'seat',
          bounds: { minX: 1, minY: -1, maxX: 3, maxY: 1 },
          geometry: { position: { x: 2, y: 0 } },
        },
      ],
      'main',
      identity,
    );
    const seatB = previous.items[1];
    if (!seatB) throw new Error('Expected seat-b in the previous scene');
    const next = createRendererScene<RendererSeatGeometry>(
      2,
      [
        {
          id: 'seat-a',
          floorId: 'main',
          kind: 'seat',
          bounds: { minX: 9, minY: -1, maxX: 11, maxY: 1 },
          geometry: { position: { x: 10, y: 0 } },
        },
        seatB,
      ],
      'main',
      identity,
    );
    renderer.setScene(previous);
    const fullUploads = vi.mocked(gl.bufferData).mock.calls.length;
    vi.mocked(gl.bufferSubData).mockClear();

    expect(renderer.applySceneChanges(diffRendererScenes(previous, next))).toBe(
      true,
    );

    expect(gl.bufferData).toHaveBeenCalledTimes(fullUploads);
    expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData).toHaveBeenCalledWith(
      gl.ARRAY_BUFFER,
      0,
      new Float32Array([10, 0]),
    );
    expect(renderer.pickAt({ x: 10, y: 0 })).toEqual({
      kind: 'seat',
      id: 'seat-a',
    });
    expect(renderer.getDiagnostics()).toMatchObject({
      fullSceneBuilds: 1,
      incrementalSceneUpdates: 1,
      partialBufferUploads: 1,
    });
    renderer.dispose();
  });

  it('rejects stale scene revisions and rebuilds buffers for structural changes', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    const identity = { documentId: 'doc-1', sessionId: 'session-1' } as const;
    const first = createRendererScene<RendererSeatGeometry>(
      1,
      [
        {
          id: 'seat-a',
          floorId: 'main',
          kind: 'seat',
          bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
          geometry: { position: { x: 0, y: 0 } },
        },
      ],
      'main',
      identity,
    );
    const seatA = first.items[0];
    if (!seatA) throw new Error('Expected seat-a in the first scene');
    const second = createRendererScene<RendererSeatGeometry>(
      2,
      [
        seatA,
        {
          id: 'seat-b',
          floorId: 'main',
          kind: 'seat',
          bounds: { minX: 1, minY: -1, maxX: 3, maxY: 1 },
          geometry: { position: { x: 2, y: 0 } },
        },
      ],
      'main',
      identity,
    );
    const stale = createRendererScene<RendererSeatGeometry>(
      2,
      [seatA],
      'main',
      identity,
    );
    const third = createRendererScene<RendererSeatGeometry>(
      3,
      [seatA],
      'main',
      identity,
    );
    renderer.setScene(first);
    const fullUploads = vi.mocked(gl.bufferData).mock.calls.length;

    expect(renderer.applySceneChanges(diffRendererScenes(first, second))).toBe(
      true,
    );
    expect(renderer.applySceneChanges(diffRendererScenes(first, stale))).toBe(
      false,
    );
    expect(renderer.applySceneChanges(diffRendererScenes(second, third))).toBe(
      true,
    );
    expect(gl.bufferData).toHaveBeenCalledTimes(fullUploads + 16);
    expect(renderer.pickAt({ x: 100, y: 0 })).toBeNull();
    expect(renderer.getDiagnostics()).toMatchObject({
      fullSceneBuilds: 1,
      incrementalSceneUpdates: 2,
      rejectedSceneChanges: 1,
    });
    renderer.dispose();
  });

  it('clears stale styles and accepts a new document revision baseline', () => {
    const gl = fakeContext();
    const target = Object.assign(new EventTarget(), {
      width: 0,
      height: 0,
      getContext: vi.fn(() => gl),
    }) as unknown as HTMLCanvasElement;
    const renderer = new WebGLHallRenderer(target);
    const seat = {
      id: 'seat-a',
      floorId: 'main',
      kind: 'seat' as const,
      bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
      geometry: { position: { x: 0, y: 0 } },
    };
    const seatB = {
      id: 'seat-b',
      floorId: 'main',
      kind: 'seat' as const,
      bounds: { minX: 1, minY: -1, maxX: 3, maxY: 1 },
      geometry: { position: { x: 2, y: 0 } },
    };
    const first = createRendererScene<RendererSeatGeometry>(
      20,
      [seat, seatB],
      'main',
      {
        documentId: 'doc-1',
        sessionId: 'session-1',
      },
    );
    const second = createRendererScene<RendererSeatGeometry>(
      21,
      [seat],
      'main',
      {
        documentId: 'doc-1',
        sessionId: 'session-1',
      },
    );
    const third = createRendererScene<RendererSeatGeometry>(
      22,
      [seat, seatB],
      'main',
      {
        documentId: 'doc-1',
        sessionId: 'session-1',
      },
    );
    const newDocument = createRendererScene<RendererSeatGeometry>(
      1,
      [seat],
      'main',
      {
        documentId: 'doc-2',
        sessionId: 'session-1',
      },
    );
    expect(renderer.setScene(first)).toBe(true);
    renderer.updateSeats([{ id: 'seat-b', status: 'sold' }]);

    expect(renderer.setScene(second)).toBe(true);
    expect(renderer.setScene(third)).toBe(true);
    const thirdSceneUploads = vi.mocked(gl.bufferData).mock.calls.slice(-8);
    expect(thirdSceneUploads[4]?.[1]).toEqual(new Float32Array([0, 0]));
    expect(renderer.setScene(newDocument)).toBe(true);
    expect(renderer.setScene(first)).toBe(false);

    expect(renderer.getDiagnostics()).toMatchObject({
      fullSceneBuilds: 4,
      rejectedSceneChanges: 1,
    });
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

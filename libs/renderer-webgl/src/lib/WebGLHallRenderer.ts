import type { Vector2 } from '@hall-platform/geometry';
import { SpatialIndex, type SpatialBounds } from '@hall-platform/geometry';
import {
  screenToWorld,
  seatSymbolBounds,
  type RendererContract,
  type RendererEvent,
  type RendererScene,
  type RendererSeatGeometry,
  type RendererSeatPositionUpdate,
  type RendererSeatUpdate,
  type RendererTargetRef,
  type SceneItem,
  type Viewport,
} from '@hall-platform/renderer-core';
import { canvasPixelSize } from './canvasSize.js';
import { observeWebGLContext } from './contextLifecycle.js';
import { WebGLResourceManager } from './resourceManager.js';
import {
  createSeatBuffers,
  updateSeatSelection,
  updateSeatPositions,
  updateSeatStatuses,
  type BufferRange,
  type SeatBuffers,
  updateSeatFillColors,
} from './seatBuffers.js';
import { seatFragmentShader, seatVertexShader } from './seatShaders.js';
import { hitTestSeatScene } from './seatHitTest.js';

export type WebGLRendererOptions = Readonly<{
  preserveDrawingBuffer?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onError?: (error: Error) => void;
}>;

type Uniforms = Readonly<{
  resolution: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
}>;

type AttributeBinding = Readonly<{
  location: number;
  bufferName: string;
  size: number;
  divisor: number;
  type: number;
  normalized: boolean;
  bytesPerElement: number;
}>;

const renderBlockSize = 64;

const cornerVertices = new Float32Array([
  -1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1,
]);

export class WebGLHallRenderer implements RendererContract<RendererSeatGeometry> {
  private readonly gl: WebGL2RenderingContext;
  private readonly resources = new WebGLResourceManager();
  private readonly stylesById = new Map<string, RendererSeatUpdate>();
  private scene: RendererScene<RendererSeatGeometry> | null = null;
  private readonly renderIndex = new SpatialIndex<
    SceneItem<RendererSeatGeometry>
  >(renderBlockSize);
  private buffers: SeatBuffers = createSeatBuffers([]);
  private readonly attributes = new Map<string, AttributeBinding>();
  private readonly seatItemsById = new Map<
    string,
    SceneItem<RendererSeatGeometry>
  >();
  private readonly previewPositions = new Map<string, Vector2>();
  private basePositions = new Float32Array();
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private selection: readonly RendererTargetRef[] = [];
  private eventHandler: ((event: RendererEvent) => void) | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms = { resolution: null, viewport: null };
  private frame = 0;
  private disposed = false;
  private contextLost = false;
  private stopObservingContext: (() => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly contextCallbacks: WebGLRendererOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer:
        this.contextCallbacks.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error('WebGL2 is not available for this canvas');
    this.gl = gl;
    try {
      this.initializeProgram();
    } catch (cause) {
      this.resources.dispose(this.gl);
      throw cause;
    }
    this.stopObservingContext = observeWebGLContext(canvas, {
      onLost: () => this.handleContextLost(),
      onRestored: () => this.handleContextRestored(),
    });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  setScene(scene: RendererScene<RendererSeatGeometry>): void {
    if (this.disposed) return;
    this.scene = scene;
    this.renderIndex.clear();
    this.seatItemsById.clear();
    this.previewPositions.clear();
    const seatItems = scene.items.filter(
      (item) =>
        item.kind === 'seat' &&
        (!scene.floorId || item.floorId === scene.floorId),
    );
    for (const item of seatItems) {
      this.seatItemsById.set(item.id, item);
      this.renderIndex.upsert(item.id, item.bounds, item);
    }
    const seats = seatItems.map((item) => ({ id: item.id, ...item.geometry }));
    const nextSeatIds = new Set(seats.map(({ id }) => id));
    for (const id of this.stylesById.keys())
      if (!nextSeatIds.has(id)) this.stylesById.delete(id);
    this.buffers = createSeatBuffers(seats);
    this.basePositions = new Float32Array(this.buffers.positions);
    updateSeatStatuses(this.buffers, [...this.stylesById.values()]);
    updateSeatFillColors(this.buffers, [...this.stylesById.values()]);
    updateSeatSelection(this.buffers, this.selection);
    this.uploadSeatBuffers();
    this.scheduleFrame();
  }

  updateSeats(updates: readonly RendererSeatUpdate[]): void {
    if (this.disposed) return;
    for (const update of updates) this.stylesById.set(update.id, update);
    const ranges = updateSeatStatuses(this.buffers, updates);
    const colorRanges = updateSeatFillColors(this.buffers, updates);
    this.uploadRanges('statuses', this.buffers.statuses, ranges);
    this.uploadRanges('fillColors', this.buffers.fillColors, colorRanges, 4);
    if (ranges.length > 0 || colorRanges.length > 0) this.scheduleFrame();
  }

  setPreviewPositions(positions: readonly RendererSeatPositionUpdate[]): void {
    if (this.disposed) return;
    const next = new Map(
      positions
        .filter((position) => this.seatItemsById.has(position.id))
        .map(({ id, position }) => [id, position]),
    );
    const affected = new Set([...this.previewPositions.keys(), ...next.keys()]);
    const updates: RendererSeatPositionUpdate[] = [];
    for (const id of affected) {
      const baseItem = this.seatItemsById.get(id);
      const index = this.buffers.indexById.get(id);
      if (!baseItem || index === undefined) continue;
      const position = next.get(id) ?? {
        x: this.basePositions[index * 2] ?? baseItem.geometry.position.x,
        y: this.basePositions[index * 2 + 1] ?? baseItem.geometry.position.y,
      };
      const geometry = { ...baseItem.geometry, position };
      const bounds = seatSymbolBounds(geometry);
      this.renderIndex.upsert(id, bounds, { ...baseItem, bounds, geometry });
      updates.push({ id, position });
    }
    this.previewPositions.clear();
    for (const [id, position] of next) this.previewPositions.set(id, position);
    const ranges = updateSeatPositions(this.buffers, updates);
    this.uploadRanges('positions', this.buffers.positions, ranges, 2);
    if (ranges.length > 0) this.scheduleFrame();
  }

  setViewport(viewport: Viewport): void {
    if (this.disposed) return;
    this.viewport = viewport;
    this.scheduleFrame();
  }

  setSelection(targets: readonly RendererTargetRef[]): void {
    if (this.disposed) return;
    this.selection = [...targets];
    const ranges = updateSeatSelection(this.buffers, targets);
    this.uploadRanges('selected', this.buffers.selected, ranges);
    if (ranges.length > 0) this.scheduleFrame();
  }

  resize(
    width: number,
    height: number,
    pixelRatio = window.devicePixelRatio,
  ): void {
    if (this.disposed) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const size = canvasPixelSize(this.width, this.height, pixelRatio);
    this.pixelRatio = size.pixelRatio;
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.gl.viewport(0, 0, size.width, size.height);
    this.scheduleFrame();
  }

  setEventHandler(handler: ((event: RendererEvent) => void) | null): void {
    if (this.disposed) return;
    this.eventHandler = handler;
  }

  pickAt(screen: Vector2): RendererTargetRef | null {
    if (!this.scene || this.disposed) return null;
    const world = screenToWorld(this.viewport, screen);
    return hitTestSeatScene(
      this.scene,
      world,
      this.scene.floorId,
      8 / Math.max(this.viewport.scale, 0.1),
    );
  }

  emitPick(screen: Vector2): void {
    if (this.disposed) return;
    const world = screenToWorld(this.viewport, screen);
    const target = this.pickAt(screen);
    if (target) this.eventHandler?.({ type: 'pick', target, world });
  }

  emitHover(screen: Vector2 | null): void {
    if (this.disposed) return;
    if (!screen) {
      this.eventHandler?.({ type: 'hover', target: null, world: null });
      return;
    }
    const world = screenToWorld(this.viewport, screen);
    this.eventHandler?.({ type: 'hover', target: this.pickAt(screen), world });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFrame();
    this.stopObservingContext?.();
    this.stopObservingContext = null;
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
    this.resources.dispose(this.gl);
    this.eventHandler = null;
    this.scene = null;
    this.renderIndex.clear();
    this.seatItemsById.clear();
    this.previewPositions.clear();
    this.basePositions = new Float32Array();
    this.attributes.clear();
    this.stylesById.clear();
  }

  private initializeProgram(): void {
    const vertex = this.compileShader(this.gl.VERTEX_SHADER, seatVertexShader);
    let fragment: WebGLShader;
    try {
      fragment = this.compileShader(
        this.gl.FRAGMENT_SHADER,
        seatFragmentShader,
      );
    } catch (error) {
      this.gl.deleteShader(vertex);
      throw error;
    }
    const program = this.gl.createProgram();
    if (!program) {
      this.gl.deleteShader(vertex);
      this.gl.deleteShader(fragment);
      throw new Error('Unable to create WebGL seat program');
    }
    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const message =
        this.gl.getProgramInfoLog(program) ?? 'unknown link error';
      this.gl.deleteProgram(program);
      this.gl.deleteShader(vertex);
      this.gl.deleteShader(fragment);
      throw new Error(`Unable to link WebGL seat program: ${message}`);
    }
    this.resources.trackShader(vertex);
    this.resources.trackShader(fragment);
    this.program = this.resources.trackProgram(program);
    this.uniforms = {
      resolution: this.gl.getUniformLocation(program, 'u_resolution'),
      viewport: this.gl.getUniformLocation(program, 'u_viewport'),
    };
    this.gl.useProgram(program);
    this.resources.uploadBuffer(this.gl, 'corners', cornerVertices);
    this.bindAttribute('a_corner', 'corners', 2, 0);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate WebGL shader');
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message =
        this.gl.getShaderInfoLog(shader) ?? 'unknown compile error';
      this.gl.deleteShader(shader);
      throw new Error(`Unable to compile WebGL seat shader: ${message}`);
    }
    return shader;
  }

  private uploadSeatBuffers(): void {
    if (this.contextLost) return;
    this.resources.uploadBuffer(
      this.gl,
      'positions',
      this.buffers.positions,
      this.gl.DYNAMIC_DRAW,
    );
    this.resources.uploadBuffer(this.gl, 'rotations', this.buffers.rotations);
    this.resources.uploadBuffer(
      this.gl,
      'symbolKinds',
      this.buffers.symbolKinds,
    );
    this.resources.uploadBuffer(this.gl, 'diameters', this.buffers.diameters);
    this.resources.uploadBuffer(
      this.gl,
      'statuses',
      this.buffers.statuses,
      this.gl.DYNAMIC_DRAW,
    );
    this.resources.uploadBuffer(
      this.gl,
      'selected',
      this.buffers.selected,
      this.gl.DYNAMIC_DRAW,
    );
    this.resources.uploadBuffer(
      this.gl,
      'fillColors',
      this.buffers.fillColors,
      this.gl.DYNAMIC_DRAW,
    );
    this.bindAttribute('a_position', 'positions', 2, 1);
    this.bindAttribute('a_rotation', 'rotations', 1, 1);
    this.bindAttribute('a_symbolKind', 'symbolKinds', 1, 1);
    this.bindAttribute('a_diameter', 'diameters', 1, 1);
    this.bindAttribute('a_status', 'statuses', 1, 1);
    this.bindAttribute('a_selected', 'selected', 1, 1);
    this.bindAttribute(
      'a_fillColor',
      'fillColors',
      4,
      1,
      this.gl.UNSIGNED_BYTE,
      true,
    );
  }

  private bindAttribute(
    name: string,
    bufferName: string,
    size: number,
    divisor: number,
    type: number = this.gl.FLOAT,
    normalized = false,
  ): void {
    const location = this.gl.getAttribLocation(this.program!, name);
    if (location < 0) throw new Error(`Missing WebGL attribute: ${name}`);
    const buffer = this.resources.buffer(bufferName);
    if (!buffer) throw new Error(`Missing WebGL buffer: ${bufferName}`);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.enableVertexAttribArray(location);
    this.gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
    this.gl.vertexAttribDivisor(location, divisor);
    this.attributes.set(name, {
      location,
      bufferName,
      size,
      divisor,
      type,
      normalized,
      bytesPerElement:
        type === this.gl.UNSIGNED_BYTE
          ? Uint8Array.BYTES_PER_ELEMENT
          : Float32Array.BYTES_PER_ELEMENT,
    });
  }

  private uploadRanges(
    bufferName: string,
    data: Float32Array | Uint8Array,
    ranges: readonly Readonly<{ start: number; count: number }>[],
    components = 1,
  ): void {
    if (this.contextLost || this.disposed) return;
    for (const range of ranges) {
      this.resources.updateBuffer(
        this.gl,
        bufferName,
        range.start * components * data.BYTES_PER_ELEMENT,
        data.subarray(
          range.start * components,
          (range.start + range.count) * components,
        ),
      );
    }
  }

  private scheduleFrame(): void {
    if (this.frame || this.disposed || this.contextLost || document.hidden)
      return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private cancelFrame(): void {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private render(): void {
    if (!this.program || this.disposed || this.contextLost) return;
    this.gl.useProgram(this.program);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (this.uniforms.resolution)
      this.gl.uniform2f(
        this.uniforms.resolution,
        this.canvas.width,
        this.canvas.height,
      );
    if (this.uniforms.viewport)
      this.gl.uniform3f(
        this.uniforms.viewport,
        this.viewport.x * this.pixelRatio,
        this.viewport.y * this.pixelRatio,
        this.viewport.scale * this.pixelRatio,
      );
    for (const range of this.visibleSeatRanges()) {
      this.bindInstanceAttributesAt(range.start);
      this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, range.count);
    }
  }

  private visibleSeatRanges(): BufferRange[] {
    if (!this.scene || this.buffers.ids.length === 0) return [];
    const scale = Math.max(0.0001, this.viewport.scale);
    const bounds: SpatialBounds = {
      minX: -this.viewport.x / scale,
      minY: -this.viewport.y / scale,
      maxX: (this.width - this.viewport.x) / scale,
      maxY: (this.height - this.viewport.y) / scale,
    };
    const indexes: number[] = [];
    for (const entry of this.renderIndex.search(bounds)) {
      const index = this.buffers.indexById.get(entry.value.id);
      if (index !== undefined) indexes.push(index);
    }
    if (indexes.length === 0) return [];
    if (indexes.length === this.buffers.ids.length)
      return [{ start: 0, count: indexes.length }];

    indexes.sort((first, second) => first - second);
    const ranges: BufferRange[] = [];
    let start = indexes[0] ?? 0;
    let previous = start;
    for (const index of indexes.slice(1)) {
      if (index === previous + 1) {
        previous = index;
        continue;
      }
      ranges.push({ start, count: previous - start + 1 });
      start = index;
      previous = index;
    }
    ranges.push({ start, count: previous - start + 1 });
    return ranges;
  }

  private bindInstanceAttributesAt(instanceIndex: number): void {
    for (const binding of this.attributes.values()) {
      if (binding.divisor === 0) continue;
      const buffer = this.resources.buffer(binding.bufferName);
      if (!buffer) continue;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.gl.vertexAttribPointer(
        binding.location,
        binding.size,
        binding.type,
        binding.normalized,
        0,
        instanceIndex * binding.size * binding.bytesPerElement,
      );
    }
  }

  private handleContextLost(): void {
    this.contextLost = true;
    this.cancelFrame();
    this.resources.dispose(this.gl);
    this.program = null;
    this.contextCallbacks.onContextLost?.();
  }

  private handleContextRestored(): void {
    if (this.disposed) return;
    try {
      this.contextLost = false;
      this.initializeProgram();
      this.uploadSeatBuffers();
      this.contextCallbacks.onContextRestored?.();
      this.scheduleFrame();
    } catch (cause) {
      this.contextLost = true;
      this.program = null;
      this.attributes.clear();
      this.resources.dispose(this.gl);
      this.contextCallbacks.onError?.(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) this.cancelFrame();
    else this.scheduleFrame();
  };
}

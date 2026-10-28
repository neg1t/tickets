import type { Vector2 } from '@hall-platform/geometry';
import { SpatialIndex, type SpatialBounds } from '@hall-platform/geometry';
import {
  screenToWorld,
  hitSeatSymbol,
  seatSymbolBounds,
  type RendererContract,
  type RendererEvent,
  type RendererScene,
  type RendererSceneChangeSet,
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
  updateSeatGeometry,
  updateSeatStatuses,
  updateSeatStrokeColors,
  type BufferRange,
  type SeatBuffers,
  updateSeatFillColors,
  parseSeatColor,
} from './seatBuffers.js';
import { seatFragmentShader, seatVertexShader } from './seatShaders.js';

export type WebGLRendererOptions = Readonly<{
  preserveDrawingBuffer?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onFrameRendered?: () => void;
  onError?: (error: Error) => void;
}>;

export type WebGLRendererDiagnostics = Readonly<{
  fullSceneBuilds: number;
  incrementalSceneUpdates: number;
  rejectedSceneChanges: number;
  fullBufferUploads: number;
  partialBufferUploads: number;
}>;

type Uniforms = Readonly<{
  resolution: WebGLUniformLocation | null;
  viewport: WebGLUniformLocation | null;
  selectedColor: WebGLUniformLocation | null;
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

function boundsContain(
  container: SpatialBounds,
  bounds: SpatialBounds,
): boolean {
  return (
    container.minX <= bounds.minX &&
    container.minY <= bounds.minY &&
    container.maxX >= bounds.maxX &&
    container.maxY >= bounds.maxY
  );
}

function boundsIntersect(first: SpatialBounds, second: SpatialBounds): boolean {
  return (
    first.minX <= second.maxX &&
    first.maxX >= second.minX &&
    first.minY <= second.maxY &&
    first.maxY >= second.minY
  );
}

export class WebGLHallRenderer implements RendererContract<RendererSeatGeometry> {
  private readonly gl: WebGL2RenderingContext;
  private readonly resources = new WebGLResourceManager();
  private readonly stylesById = new Map<string, RendererSeatUpdate>();
  private scene: RendererScene<RendererSeatGeometry> | null = null;
  private readonly renderIndex = new SpatialIndex<
    SceneItem<RendererSeatGeometry>
  >(renderBlockSize);
  private visibleSeatRangesCache: {
    bounds: SpatialBounds;
    candidates: { index: number; bounds: SpatialBounds }[];
  } | null = null;
  private buffers: SeatBuffers = createSeatBuffers([]);
  private readonly attributes = new Map<string, AttributeBinding>();
  private readonly seatItemsById = new Map<
    string,
    SceneItem<RendererSeatGeometry>
  >();
  private readonly seatOrderById = new Map<string, number>();
  private readonly previewPositions = new Map<string, Vector2>();
  private basePositions = new Float32Array();
  private viewport: Viewport = { x: 0, y: 0, scale: 1 };
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private selection: readonly RendererTargetRef[] = [];
  private selectedColor: readonly [number, number, number] = [237, 137, 54];
  private eventHandler: ((event: RendererEvent) => void) | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms = {
    resolution: null,
    viewport: null,
    selectedColor: null,
  };
  private frame = 0;
  private disposed = false;
  private contextLost = false;
  private stopObservingContext: (() => void) | null = null;
  private diagnostics = {
    fullSceneBuilds: 0,
    incrementalSceneUpdates: 0,
    rejectedSceneChanges: 0,
    fullBufferUploads: 0,
    partialBufferUploads: 0,
  };
  private readonly acceptedRevisionsByIdentity = new Map<string, number>();

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

  setScene(scene: RendererScene<RendererSeatGeometry>): boolean {
    if (this.disposed) return false;
    const identityKey = this.sceneIdentityKey(scene);
    const lastAcceptedRevision =
      this.acceptedRevisionsByIdentity.get(identityKey);
    if (
      lastAcceptedRevision !== undefined &&
      scene.revision <= lastAcceptedRevision
    ) {
      this.diagnostics.rejectedSceneChanges += 1;
      this.updateDiagnosticsAttributes();
      return false;
    }
    const sameIdentity =
      this.scene?.identity?.documentId === scene.identity?.documentId &&
      this.scene?.identity?.sessionId === scene.identity?.sessionId;
    if (this.scene && sameIdentity && scene.revision <= this.scene.revision) {
      this.diagnostics.rejectedSceneChanges += 1;
      this.updateDiagnosticsAttributes();
      return false;
    }
    if (this.scene && !sameIdentity) {
      this.stylesById.clear();
      this.selection = [];
    }
    if (this.scene && sameIdentity) {
      const nextSeatIds = new Set(scene.sourceItemIds);
      for (const id of this.stylesById.keys())
        if (!nextSeatIds.has(id)) this.stylesById.delete(id);
    }
    this.scene = scene;
    this.visibleSeatRangesCache = null;
    this.renderIndex.clear();
    this.seatItemsById.clear();
    this.seatOrderById.clear();
    this.previewPositions.clear();
    const seatItems = scene.items.filter(
      (item) =>
        item.kind === 'seat' &&
        (!scene.floorId || item.floorId === scene.floorId),
    );
    for (const item of seatItems) {
      this.seatItemsById.set(item.id, item);
      this.seatOrderById.set(item.id, scene.itemOrder.get(item) ?? 0);
      this.renderIndex.upsert(item.id, item.bounds, item);
    }
    const seats = seatItems.map((item) => ({ id: item.id, ...item.geometry }));
    this.buffers = createSeatBuffers(seats);
    this.basePositions = new Float32Array(this.buffers.positions);
    updateSeatStatuses(this.buffers, [...this.stylesById.values()]);
    updateSeatFillColors(this.buffers, [...this.stylesById.values()]);
    updateSeatStrokeColors(this.buffers, [...this.stylesById.values()]);
    updateSeatSelection(this.buffers, this.selection);
    this.uploadSeatBuffers();
    this.acceptedRevisionsByIdentity.set(identityKey, scene.revision);
    this.diagnostics.fullSceneBuilds += 1;
    this.updateDiagnosticsAttributes();
    this.scheduleFrame();
    return true;
  }

  applySceneChanges(
    changes: RendererSceneChangeSet<RendererSeatGeometry>,
  ): boolean {
    const current = this.scene;
    const next = changes.scene;
    if (
      this.disposed ||
      !current ||
      changes.replace ||
      changes.baseRevision !== current.revision ||
      changes.revision !== next.revision ||
      changes.revision <= changes.baseRevision ||
      current.floorId !== next.floorId ||
      current.identity?.documentId !== changes.identity?.documentId ||
      current.identity?.sessionId !== changes.identity?.sessionId ||
      next.identity?.documentId !== changes.identity?.documentId ||
      next.identity?.sessionId !== changes.identity?.sessionId
    ) {
      if (!this.disposed) {
        this.diagnostics.rejectedSceneChanges += 1;
        this.updateDiagnosticsAttributes();
      }
      return false;
    }

    if (this.previewPositions.size > 0) this.setPreviewPositions([]);
    for (const id of changes.removedSourceIds) this.stylesById.delete(id);
    const addedSeats: SceneItem<RendererSeatGeometry>[] = [];
    const updatedSeats: SceneItem<RendererSeatGeometry>[] = [];
    let removedSeat = false;
    for (const key of changes.removed) {
      const item = current.itemByKey.get(key);
      if (
        !item ||
        item.kind !== 'seat' ||
        (current.floorId && item.floorId !== current.floorId)
      )
        continue;
      this.seatItemsById.delete(item.id);
      this.seatOrderById.delete(item.id);
      this.renderIndex.remove(item.id);
      this.stylesById.delete(item.id);
      removedSeat = true;
    }
    for (const item of changes.added) {
      if (
        item.kind !== 'seat' ||
        (next.floorId && item.floorId !== next.floorId)
      )
        continue;
      this.seatItemsById.set(item.id, item);
      this.seatOrderById.set(item.id, next.itemOrder.get(item) ?? 0);
      this.renderIndex.upsert(item.id, item.bounds, item);
      addedSeats.push(item);
    }
    for (const item of changes.updated) {
      if (
        item.kind !== 'seat' ||
        (next.floorId && item.floorId !== next.floorId)
      )
        continue;
      this.seatItemsById.set(item.id, item);
      this.seatOrderById.set(item.id, next.itemOrder.get(item) ?? 0);
      this.renderIndex.upsert(item.id, item.bounds, item);
      updatedSeats.push(item);
    }
    this.scene = next;
    this.visibleSeatRangesCache = null;

    if (removedSeat || addedSeats.length > 0 || changes.orderChanged) {
      const seats = next.items
        .filter(
          (item) =>
            item.kind === 'seat' &&
            (!next.floorId || item.floorId === next.floorId),
        )
        .map((item) => ({ id: item.id, ...item.geometry }));
      this.seatItemsById.clear();
      this.seatOrderById.clear();
      for (const item of next.items) {
        if (
          item.kind === 'seat' &&
          (!next.floorId || item.floorId === next.floorId)
        ) {
          this.seatItemsById.set(item.id, item);
          this.seatOrderById.set(item.id, next.itemOrder.get(item) ?? 0);
        }
      }
      this.buffers = createSeatBuffers(seats);
      this.basePositions = new Float32Array(this.buffers.positions);
      updateSeatStatuses(this.buffers, [...this.stylesById.values()]);
      updateSeatFillColors(this.buffers, [...this.stylesById.values()]);
      updateSeatStrokeColors(this.buffers, [...this.stylesById.values()]);
      updateSeatSelection(this.buffers, this.selection);
      this.uploadSeatBuffers();
    } else if (updatedSeats.length > 0) {
      const ranges = updateSeatGeometry(
        this.buffers,
        updatedSeats.map(({ id, geometry }) => ({ id, geometry })),
      );
      this.uploadRanges(
        'positions',
        this.buffers.positions,
        ranges.positions,
        2,
      );
      this.uploadRanges('rotations', this.buffers.rotations, ranges.rotations);
      this.uploadRanges(
        'symbolKinds',
        this.buffers.symbolKinds,
        ranges.symbolKinds,
      );
      this.uploadRanges('diameters', this.buffers.diameters, ranges.diameters);
      this.basePositions = new Float32Array(this.buffers.positions);
    }
    if (changes.styles.length > 0) this.updateSeats(changes.styles);
    this.acceptedRevisionsByIdentity.set(
      this.sceneIdentityKey(next),
      next.revision,
    );
    this.diagnostics.incrementalSceneUpdates += 1;
    this.updateDiagnosticsAttributes();
    this.scheduleFrame();
    return true;
  }

  getDiagnostics(): WebGLRendererDiagnostics {
    return { ...this.diagnostics };
  }

  updateSeats(updates: readonly RendererSeatUpdate[]): void {
    if (this.disposed) return;
    for (const update of updates) this.stylesById.set(update.id, update);
    const ranges = updateSeatStatuses(this.buffers, updates);
    const colorRanges = updateSeatFillColors(this.buffers, updates);
    const strokeColorRanges = updateSeatStrokeColors(this.buffers, updates);
    this.uploadRanges('statuses', this.buffers.statuses, ranges);
    this.uploadRanges('fillColors', this.buffers.fillColors, colorRanges, 4);
    this.uploadRanges(
      'strokeColors',
      this.buffers.strokeColors,
      strokeColorRanges,
      4,
    );
    this.updateDiagnosticsAttributes();
    if (
      ranges.length > 0 ||
      colorRanges.length > 0 ||
      strokeColorRanges.length > 0
    )
      this.scheduleFrame();
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
    this.updateDiagnosticsAttributes();
    if (ranges.length > 0) {
      this.visibleSeatRangesCache = null;
      this.scheduleFrame();
    }
  }

  setViewport(viewport: Viewport): void {
    if (this.disposed) return;
    this.viewport = viewport;
    this.scheduleFrame();
  }

  applyViewportFrame(viewport: Viewport): void {
    if (this.disposed) return;
    this.viewport = viewport;
    this.cancelFrame();
    this.render();
    if (this.program && !this.contextLost && viewport.revision !== undefined)
      this.canvas.dataset.cameraRevision = String(viewport.revision);
  }

  setSelection(targets: readonly RendererTargetRef[]): void {
    if (this.disposed) return;
    this.selection = [...targets];
    const ranges = updateSeatSelection(this.buffers, targets);
    this.uploadRanges('selected', this.buffers.selected, ranges);
    this.updateDiagnosticsAttributes();
    if (ranges.length > 0) this.scheduleFrame();
  }

  setSelectedColor(color: string): void {
    const parsed = parseSeatColor(color);
    if (
      !parsed ||
      parsed.every((channel, index) => channel === this.selectedColor[index])
    )
      return;
    this.selectedColor = parsed;
    this.scheduleFrame();
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
    const tolerance = 8 / Math.max(this.viewport.scale, 0.1);
    const candidates = this.renderIndex
      .search({
        minX: world.x - tolerance,
        minY: world.y - tolerance,
        maxX: world.x + tolerance,
        maxY: world.y + tolerance,
      })
      .map(({ value }) => value)
      .sort(
        (first, second) =>
          (this.seatOrderById.get(first.id) ?? 0) -
          (this.seatOrderById.get(second.id) ?? 0),
      );
    const hit = candidates.find(
      (item) =>
        item.kind === 'seat' && hitSeatSymbol(item.geometry, world, tolerance),
    );
    return hit ? { kind: hit.kind, id: hit.id } : null;
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
    this.seatOrderById.clear();
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
      selectedColor: this.gl.getUniformLocation(program, 'u_selectedColor'),
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
    this.resources.uploadBuffer(
      this.gl,
      'strokeColors',
      this.buffers.strokeColors,
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
    this.bindAttribute(
      'a_strokeColor',
      'strokeColors',
      4,
      1,
      this.gl.UNSIGNED_BYTE,
      true,
    );
    this.diagnostics.fullBufferUploads += 8;
  }

  private bindAttribute(
    name: string,
    bufferName: string,
    size: number,
    divisor: number,
    type: number = this.gl.FLOAT,
    normalized = false,
  ): void {
    const program = this.program;
    if (!program) throw new Error('WebGL seat program is not initialized');
    const location = this.gl.getAttribLocation(program, name);
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
      this.diagnostics.partialBufferUploads += 1;
    }
  }

  private updateDiagnosticsAttributes(): void {
    if (!this.canvas.dataset) return;
    this.canvas.dataset.sceneRevision = String(this.scene?.revision ?? '');
    this.canvas.dataset.fullSceneBuilds = String(
      this.diagnostics.fullSceneBuilds,
    );
    this.canvas.dataset.incrementalSceneUpdates = String(
      this.diagnostics.incrementalSceneUpdates,
    );
    this.canvas.dataset.rejectedSceneChanges = String(
      this.diagnostics.rejectedSceneChanges,
    );
    this.canvas.dataset.fullBufferUploads = String(
      this.diagnostics.fullBufferUploads,
    );
    this.canvas.dataset.partialBufferUploads = String(
      this.diagnostics.partialBufferUploads,
    );
  }

  private sceneIdentityKey(scene: RendererScene<RendererSeatGeometry>): string {
    return scene.identity
      ? JSON.stringify([scene.identity.documentId, scene.identity.sessionId])
      : 'legacy-scene';
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
    if (this.uniforms.selectedColor)
      this.gl.uniform4f(
        this.uniforms.selectedColor,
        (this.selectedColor[0] ?? 237) / 255,
        (this.selectedColor[1] ?? 137) / 255,
        (this.selectedColor[2] ?? 54) / 255,
        1,
      );
    for (const range of this.visibleSeatRanges()) {
      this.bindInstanceAttributesAt(range.start);
      this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, range.count);
    }
    if (this.scene) this.contextCallbacks.onFrameRendered?.();
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
    const cached = this.visibleSeatRangesCache;

    const marginX = (bounds.maxX - bounds.minX) * 0.25;
    const marginY = (bounds.maxY - bounds.minY) * 0.25;
    const queryBounds: SpatialBounds = {
      minX: bounds.minX - marginX,
      minY: bounds.minY - marginY,
      maxX: bounds.maxX + marginX,
      maxY: bounds.maxY + marginY,
    };
    let candidates = cached?.candidates;
    if (!cached || !boundsContain(cached.bounds, bounds)) {
      candidates = [];
      for (const entry of this.renderIndex.search(queryBounds)) {
        const index = this.buffers.indexById.get(entry.value.id);
        if (index !== undefined)
          candidates.push({ index, bounds: entry.bounds });
      }
      candidates.sort((first, second) => first.index - second.index);
      this.visibleSeatRangesCache = { bounds: queryBounds, candidates };
    }

    const ranges: BufferRange[] = [];
    let start = -1;
    let previous = -1;
    for (const candidate of candidates ?? []) {
      if (!boundsIntersect(candidate.bounds, bounds)) continue;
      if (start < 0) {
        start = candidate.index;
        previous = candidate.index;
        continue;
      }
      if (candidate.index === previous + 1) {
        previous = candidate.index;
        continue;
      }
      ranges.push({ start, count: previous - start + 1 });
      start = candidate.index;
      previous = candidate.index;
    }
    if (start >= 0) ranges.push({ start, count: previous - start + 1 });
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

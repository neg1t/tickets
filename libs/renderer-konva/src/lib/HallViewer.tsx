import {
  isValidElement,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import type { LayoutSnapshot } from '@hall-platform/domain';
import {
  defaultHallCanvasPalette,
  readHallCanvasPalette,
} from '@hall-platform/design-tokens';
import type { SpatialBounds, Vector2 } from '@hall-platform/geometry';
import type Konva from 'konva';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Shape,
  Text,
} from 'react-konva';

import { HallStage } from './HallStage.js';
import { SeatLabel } from './FurnitureSymbols.js';
import { seatLevelOfDetail, visibleSeatLabelIds } from './furniture.js';
import { DotSeatBatcher, type DotSeatBatch } from './seatBatches.js';
import { ObjectRenderer } from './ObjectRenderer.js';
import { SelectionOverlay } from './SelectionOverlay.js';
import {
  buildHallScene,
  hitTestHallScene,
  selectionBounds,
  targetBounds,
  visibleHallScene,
  type HallTarget,
} from './hallScene.js';
import {
  fitViewport,
  panViewportBy,
  screenToWorld,
  zoomViewportAt,
  type Viewport,
} from './viewport.js';
import { DragPreview } from './interaction/DragPreview.js';
import { movedTargetKeys } from './interaction/movedTargetKeys.js';
import { usePointerInteraction } from './interaction/usePointerInteraction.js';
import {
  boxSelectedTargets,
  editHandleGeometry,
  gridStepForScale,
  handlesForTarget,
  hitHandle,
  shouldStartBoxSelection,
  snapPoint,
  snappedMoveDelta,
  type PolygonEditMode,
} from './directManipulation.js';

export type { PolygonEditMode } from './directManipulation.js';

export type HallViewerLabels = Readonly<{
  hall: string;
  toolbar: string;
  select: string;
  pan: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  reset: string;
  zoomSelection: string;
  zone: string;
  zoomZone: string;
  allZones: string;
  floor: string;
  scale: string;
  selected: string;
  grid?: string;
}>;

export type HallViewerProps = {
  readonly snapshot: LayoutSnapshot;
  readonly hallName: string;
  readonly height?: number;
  readonly fitKey?: string;
  readonly stageId?: string;
  readonly labels?: Partial<HallViewerLabels>;
  readonly focusedFloorId?: string;
  readonly focusedZoneId?: string;
  readonly seatAppearance?: Readonly<
    Record<string, { fill: string; stroke?: string }>
  >;
  readonly previewSeats?: readonly Vector2[];
  readonly zoneBounds?: Readonly<Record<string, SpatialBounds>>;
  readonly backgroundPages?: Readonly<
    Record<
      string,
      { width: number; height: number; canvas?: HTMLCanvasElement }
    >
  >;
  readonly viewerMode?: 'edit' | 'view' | 'pick';
  readonly activeTool?: string;
  readonly polygonEditMode?: PolygonEditMode;
  readonly selectedTargets?: readonly HallTarget[];
  readonly onCanvasClick?: (point: Vector2, target: HallTarget | null) => void;
  readonly onObjectMove?: (target: HallTarget, delta: Vector2) => void;
  readonly onObjectsMove?: (
    targets: readonly HallTarget[],
    delta: Vector2,
  ) => void;
  readonly onSelectionChange?: (selection: readonly HallTarget[]) => void;
  readonly onFloorChange?: (floorId: string) => void;
  readonly onHandleCommit?: (
    target: HallTarget,
    handleId: string,
    worldPoint: Vector2,
  ) => void;
  readonly onPointerWorldMove?: (point: Vector2 | null) => void;
  readonly onHoverTarget?: (target: HallTarget | null) => void;
  readonly calibrationGuide?: Readonly<{ first: Vector2; second: Vector2 }>;
};

type PointerMode = 'pan' | 'pick' | 'edit' | 'create' | 'box' | 'handle';
type PointerIntent = {
  mode: PointerMode;
  target: HallTarget | null;
  targets: readonly HallTarget[];
  selectionReady: boolean;
  lastScreen: Vector2;
  modifiers: { shift: boolean; ctrl: boolean; meta: boolean };
  handleId?: string | undefined;
};

const farZoomTargets = new Set<HallTarget['kind']>(['zone']);
const emptySeatAppearance = {};

const DotSeatBatchShape = memo(function DotSeatBatchShape({
  batch,
}: {
  batch: DotSeatBatch;
}) {
  const ref = useRef<Konva.Shape>(null);
  useLayoutEffect(() => {
    const shape = ref.current;
    if (!shape || batch.seats.length === 0) return;
    const { minX, minY, maxX, maxY } = batch.bounds;
    const cachePixels = (maxX - minX + 1) * (maxY - minY + 1) * 4;
    if (batch.seats.length < 16 || cachePixels > 8_000_000) return;
    shape.cache({
      x: minX - 0.5,
      y: minY - 0.5,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixelRatio: 2,
    });
    shape.getLayer()?.batchDraw();
    return () => {
      shape.clearCache();
    };
  }, [batch]);
  return (
    <Shape
      ref={ref}
      fill={batch.fills[0] ?? '#fff'}
      perfectDrawEnabled={false}
      sceneFunc={(context, shape) => {
        for (let index = 0; index < batch.seats.length; index++) {
          const seat = batch.seats[index];
          if (!seat) continue;
          const radius =
            seat.visualKind === 'wheelchairBay'
              ? 0.38
              : seat.visualKind === 'armchair'
                ? 0.35
                : 0.3;
          context.beginPath();
          context.moveTo(seat.position.x + radius, seat.position.y);
          context.arc(seat.position.x, seat.position.y, radius, 0, Math.PI * 2);
          context.closePath();
          context.setAttr('fillStyle', batch.fills[index] ?? '#fff');
          context.fill();
        }
      }}
      hitFunc={(context, shape) => {
        context.beginPath();
        for (const seat of batch.seats) {
          const radius =
            seat.visualKind === 'wheelchairBay'
              ? 0.38
              : seat.visualKind === 'armchair'
                ? 0.35
                : 0.3;
          context.moveTo(seat.position.x + radius, seat.position.y);
          context.arc(seat.position.x, seat.position.y, radius, 0, Math.PI * 2);
          context.closePath();
        }
        context.fillShape(shape);
      }}
    />
  );
});
const defaultLabels: HallViewerLabels = {
  hall: 'Схема зала',
  toolbar: 'Управление схемой',
  select: 'Выбор',
  pan: 'Перемещение',
  zoomIn: 'Увеличить',
  zoomOut: 'Уменьшить',
  fit: 'Вписать',
  reset: '100%',
  zoomSelection: 'К выбранному',
  zone: 'Зона',
  zoomZone: 'Приблизить зону',
  allZones: 'Все зоны',
  floor: 'Этаж',
  scale: 'Масштаб',
  selected: 'Выбрано',
  grid: 'Сетка · шаг 1',
};

export function HallViewer(props: HallViewerProps) {
  const {
    snapshot,
    hallName,
    height = 500,
    fitKey,
    stageId = 'hall-stage',
    labels,
    focusedFloorId,
    focusedZoneId,
    seatAppearance,
    previewSeats = [],
    zoneBounds,
    backgroundPages,
    viewerMode,
    activeTool,
    polygonEditMode,
    selectedTargets,
    onCanvasClick,
    onObjectMove,
    onObjectsMove,
    onSelectionChange,
    onFloorChange,
    onHandleCommit,
    onPointerWorldMove,
    onHoverTarget,
    calibrationGuide,
  } = props;
  const ui = { ...defaultLabels, ...labels };
  const [floorId, setFloorId] = useState(snapshot.floors[0]?.id ?? '');
  const [width, setWidth] = useState(900);
  const [palette, setPalette] = useState(defaultHallCanvasPalette);
  const requestedFloorId = focusedFloorId ?? floorId;
  const activeFloorId = snapshot.floors.some(
    (floor) => floor.id === requestedFloorId,
  )
    ? requestedFloorId
    : (snapshot.floors[0]?.id ?? '');
  const scene = useMemo(
    () => buildHallScene(snapshot, activeFloorId, zoneBounds, backgroundPages),
    [snapshot, activeFloorId, zoneBounds, backgroundPages],
  );
  const [viewport, setViewport] = useState<Viewport>(() =>
    fitViewport(scene.bounds, 900, height),
  );
  const [localSelection, setLocalSelection] = useState<HallTarget[]>([]);
  const selection = selectedTargets ?? localSelection;
  const [localTool, setLocalTool] = useState<'select' | 'pan'>('select');
  const [gridEnabled, setGridEnabled] = useState(false);
  const [hoverTarget, setHoverTarget] = useState<HallTarget | null>(null);
  const tool =
    activeTool === undefined
      ? localTool
      : activeTool === 'pan'
        ? 'pan'
        : 'select';
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setPalette(readHallCanvasPalette(container));
    update();
    const observer = new MutationObserver(update);
    for (let node: Element | null = container; node; node = node.parentElement)
      observer.observe(node, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    return () => observer.disconnect();
  }, []);
  const observedWidth = useRef(width);
  const sceneRef = useRef(scene);
  const previousFitKey = useRef(fitKey);
  const stageRef = useRef<Konva.Stage>(null);
  const { preview, begin, move, finish, cancel } = usePointerInteraction();
  const [movingKeys, setMovingKeys] = useState<ReadonlySet<string>>(new Set());
  const intentRef = useRef<PointerIntent | null>(null);
  const [renderIntent, setRenderIntent] = useState<PointerIntent | null>(null);
  const pointersRef = useRef(new Map<number, Vector2>());
  const pinchRef = useRef<{ center: Vector2; distance: number } | null>(null);
  const viewportRef = useRef(viewport);
  const dotBatcherRef = useRef<DotSeatBatcher | null>(null);
  dotBatcherRef.current ??= new DotSeatBatcher();
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    cancel();
    intentRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
  }, [snapshot, activeFloorId, activeTool, cancel]);

  useEffect(() => {
    function cancelOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      cancel();
      setMovingKeys(new Set());
      intentRef.current = null;
      setRenderIntent(null);
      pinchRef.current = null;
    }
    document.addEventListener('keydown', cancelOnEscape);
    return () => document.removeEventListener('keydown', cancelOnEscape);
  }, [cancel]);

  useEffect(() => {
    const session = preview;
    if (!session?.dragging || intentRef.current?.mode !== 'edit') return;
    let frame = 0;
    function advance() {
      if (!session) return;
      const edge = 24;
      const speed = 10;
      const pan = {
        x:
          session.screen.x < edge
            ? speed
            : session.screen.x > width - edge
              ? -speed
              : 0,
        y:
          session.screen.y < edge
            ? speed
            : session.screen.y > height - edge
              ? -speed
              : 0,
      };
      if (pan.x || pan.y) {
        const next = panViewportBy(viewportRef.current, pan);
        viewportRef.current = next;
        setViewport(next);
        move(session.pointerId, session.screen, next);
      }
      frame = requestAnimationFrame(advance);
    }
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [preview, move, width, height]);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    if (fitKey === previousFitKey.current) return;
    previousFitKey.current = fitKey;
    const focusedBounds = focusedZoneId
      ? sceneRef.current.zones.find(({ zone }) => zone.id === focusedZoneId)
          ?.bounds
      : undefined;
    setViewport(
      fitViewport(
        focusedBounds ?? sceneRef.current.bounds,
        width,
        height,
        focusedBounds ? 65 : 30,
      ),
    );
  }, [fitKey, width, height, focusedZoneId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const nextWidth = Math.max(320, Math.round(element.clientWidth));
      if (nextWidth === observedWidth.current) return;
      observedWidth.current = nextWidth;
      setWidth(nextWidth);
      setViewport(fitViewport(sceneRef.current.bounds, nextWidth, height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [height]);

  const selectedKeys = new Set(
    selection.map((target) => `${target.kind}:${target.id}`),
  );
  const interactionMode =
    viewerMode ??
    (activeTool === undefined
      ? 'view'
      : activeTool === 'pick'
        ? 'pick'
        : 'edit');
  const editorMode = interactionMode === 'edit';
  const authoringMode = editorMode;
  const handles =
    editorMode && activeTool === 'select' && onHandleCommit
      ? selection.flatMap((target) =>
          handlesForTarget(scene, target, polygonEditMode),
        )
      : [];
  const handlePreview =
    preview?.dragging &&
    renderIntent?.mode === 'handle' &&
    renderIntent.target &&
    renderIntent.handleId
      ? editHandleGeometry(
          snapshot,
          Object.fromEntries(
            scene.zones.map(({ zone, bounds }) => [zone.id, bounds]),
          ),
          renderIntent.target,
          renderIntent.handleId,
          snapPoint(screenToWorld(viewport, preview.screen), gridEnabled),
        )
      : null;
  const displayScene = handlePreview
    ? buildHallScene(
        handlePreview.snapshot,
        activeFloorId,
        handlePreview.zoneBounds,
        backgroundPages,
      )
    : scene;
  const displayHandles =
    handlePreview && renderIntent?.target
      ? handlesForTarget(displayScene, renderIntent.target, polygonEditMode)
      : handles;
  const boxBounds =
    preview?.dragging && renderIntent?.mode === 'box'
      ? {
          minX: Math.min(
            preview.startWorld.x,
            screenToWorld(viewport, preview.screen).x,
          ),
          minY: Math.min(
            preview.startWorld.y,
            screenToWorld(viewport, preview.screen).y,
          ),
          maxX: Math.max(
            preview.startWorld.x,
            screenToWorld(viewport, preview.screen).x,
          ),
          maxY: Math.max(
            preview.startWorld.y,
            screenToWorld(viewport, preview.screen).y,
          ),
        }
      : null;
  const visibleWorld = {
    minX: -viewport.x / viewport.scale,
    minY: -viewport.y / viewport.scale,
    maxX: (width - viewport.x) / viewport.scale,
    maxY: (height - viewport.y) / viewport.scale,
  };
  const previewDelta =
    preview && movingKeys.size > 0
      ? snappedMoveDelta(preview.startWorld, preview.delta, gridEnabled)
      : null;
  const positionedHandles = displayHandles.map((handle) => {
    const key = `${handle.target.kind}:${handle.target.id}`;
    const delta = previewDelta && movingKeys.has(key) ? previewDelta : null;
    return delta
      ? {
          ...handle,
          point: {
            x: handle.point.x + delta.x,
            y: handle.point.y + delta.y,
          },
        }
      : handle;
  });
  // Include a screen-space margin so symbols and labels crossing an edge stay visible.
  const margin = Math.max(2, 100 / viewport.scale);
  const rendered = useMemo(
    () =>
      visibleHallScene(displayScene, {
        minX: visibleWorld.minX - margin,
        minY: visibleWorld.minY - margin,
        maxX: visibleWorld.maxX + margin,
        maxY: visibleWorld.maxY + margin,
      }),
    [
      displayScene,
      visibleWorld.minX,
      visibleWorld.minY,
      visibleWorld.maxX,
      visibleWorld.maxY,
      margin,
    ],
  );
  const gridStep = gridStepForScale(viewport.scale);
  const gridLines =
    authoringMode && gridEnabled
      ? Array.from(
          {
            length: Math.min(
              500,
              Math.ceil((visibleWorld.maxX - visibleWorld.minX) / gridStep) + 2,
            ),
          },
          (_, index) =>
            Math.floor(visibleWorld.minX / gridStep) * gridStep +
            index * gridStep,
        )
      : [];
  const gridRows =
    authoringMode && gridEnabled
      ? Array.from(
          {
            length: Math.min(
              500,
              Math.ceil((visibleWorld.maxY - visibleWorld.minY) / gridStep) + 2,
            ),
          },
          (_, index) =>
            Math.floor(visibleWorld.minY / gridStep) * gridStep +
            index * gridStep,
        )
      : [];
  const showSeats =
    interactionMode === 'edit' ||
    scene.seats.some(
      (seat) => seatLevelOfDetail(viewport.scale, seat.visualKind) !== 'dot',
    );
  const hitTestKinds =
    showSeats || interactionMode === 'pick' ? undefined : farZoomTargets;
  const visibleLabels = useMemo(
    () =>
      visibleSeatLabelIds(rendered.seats, viewport.scale, {
        x: viewport.x,
        y: viewport.y,
        width,
        height,
      }),
    [rendered.seats, viewport.scale, viewport.x, viewport.y, width, height],
  );
  const dotCachePixels = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const seat of scene.seats) {
      minX = Math.min(minX, seat.position.x);
      minY = Math.min(minY, seat.position.y);
      maxX = Math.max(maxX, seat.position.x);
      maxY = Math.max(maxY, seat.position.y);
    }
    return scene.seats.length ? (maxX - minX + 2) * (maxY - minY + 2) * 4 : 0;
  }, [scene.seats]);
  const dotBatches = useMemo(() => {
    if (!showSeats || movingKeys.size > 0) return null;
    const visibleBounds =
      dotCachePixels > 8_000_000
        ? {
            minX: visibleWorld.minX - margin,
            minY: visibleWorld.minY - margin,
            maxX: visibleWorld.maxX + margin,
            maxY: visibleWorld.maxY + margin,
          }
        : undefined;
    return dotBatcherRef.current?.build(
      scene.seats,
      viewport.scale,
      seatAppearance ?? emptySeatAppearance,
      palette.seat,
      visibleBounds,
    );
  }, [
    showSeats,
    movingKeys.size,
    scene.seats,
    viewport.scale,
    seatAppearance,
    palette.seat,
    dotCachePixels,
    visibleWorld.minX,
    visibleWorld.minY,
    visibleWorld.maxX,
    visibleWorld.maxY,
    margin,
  ]);

  function handleFit() {
    setViewport(fitViewport(scene.bounds, width, height));
  }

  function handleReset() {
    const centerX = (scene.bounds.minX + scene.bounds.maxX) / 2;
    const centerY = (scene.bounds.minY + scene.bounds.maxY) / 2;
    setViewport({ x: width / 2 - centerX, y: height / 2 - centerY, scale: 1 });
  }

  function handleZoom(factor: number) {
    setViewport((current) =>
      zoomViewportAt(current, { x: width / 2, y: height / 2 }, factor),
    );
  }

  function handleZoomSelection() {
    const bounds = selectionBounds(scene, selection);
    if (bounds) setViewport(fitViewport(bounds, width, height, 90));
  }

  function handleZoomZone(event: ChangeEvent<HTMLSelectElement>) {
    const zone = scene.zones.find(({ zone }) => zone.id === event.target.value);
    if (zone) setViewport(fitViewport(zone.bounds, width, height, 65));
    event.target.value = '';
  }

  function handleSelection(next: HallTarget[]) {
    setLocalSelection(next);
    onSelectionChange?.(next);
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    event.evt.preventDefault();
    const point = stageRef.current?.getPointerPosition();
    if (!point) return;
    const factor = Math.exp(-event.evt.deltaY * 0.0015);
    const next = zoomViewportAt(viewportRef.current, point, factor);
    viewportRef.current = next;
    setViewport(next);
    if (preview) move(preview.pointerId, preview.screen, next);
  }

  function pointerPoint(event: PointerEvent): Vector2 | null {
    const rect = stageRef.current?.container().getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : null;
  }

  function pinchGesture(): { center: Vector2; distance: number } | null {
    const [first, second] = [...pointersRef.current.values()];
    if (!first || !second) return null;
    return {
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      distance: Math.hypot(first.x - second.x, first.y - second.y),
    };
  }

  function handlePointerDown(native: PointerEvent) {
    if (
      native.pointerType === 'mouse' &&
      native.button !== 0 &&
      native.button !== 1
    )
      return;
    const point = pointerPoint(native);
    if (!point) return;
    pointersRef.current.set(native.pointerId, point);
    if (
      native.target instanceof Element &&
      'setPointerCapture' in native.target
    )
      native.target.setPointerCapture(native.pointerId);
    if (pointersRef.current.size > 1) {
      cancel();
      setMovingKeys(new Set());
      intentRef.current = null;
      setRenderIntent(null);
      pinchRef.current = pinchGesture();
      return;
    }
    const world = screenToWorld(viewport, point);
    const nearbyHandle =
      authoringMode && activeTool === 'select'
        ? hitHandle(
            handles,
            world,
            (native.pointerType === 'touch' ? 14 : 8) / viewport.scale,
          )
        : null;
    const exactTarget = hitTestHallScene(scene, world, 0, hitTestKinds);
    const clickedSeat =
      exactTarget?.kind === 'seat' ? scene.seatsById.get(exactTarget.id) : null;
    const clickedSeatRowId =
      clickedSeat?.placement.kind === 'row'
        ? clickedSeat.placement.rowId
        : null;
    const parentRowTarget =
      clickedSeatRowId &&
      (native.altKey ||
        (selectedKeys.has(`row:${clickedSeatRowId}`) &&
          !native.shiftKey &&
          !native.ctrlKey &&
          !native.metaKey))
        ? { kind: 'row' as const, id: clickedSeatRowId }
        : null;
    const handleConflictsWithTarget = Boolean(
      nearbyHandle &&
      exactTarget &&
      `${nearbyHandle.target.kind}:${nearbyHandle.target.id}` !==
        `${exactTarget.kind}:${exactTarget.id}`,
    );
    const selectedHandle = Boolean(
      nearbyHandle &&
      selectedKeys.has(`${nearbyHandle.target.kind}:${nearbyHandle.target.id}`),
    );
    const handle = selectedHandle
      ? nearbyHandle
      : parentRowTarget || handleConflictsWithTarget
        ? null
        : nearbyHandle;
    const target =
      handle?.target ??
      parentRowTarget ??
      exactTarget ??
      hitTestHallScene(
        scene,
        world,
        (native.pointerType === 'touch' ? 10 : 3) / viewport.scale,
        hitTestKinds,
      );
    const pan =
      tool === 'pan' ||
      native.button === 1 ||
      (native.altKey && !parentRowTarget);
    const create =
      !parentRowTarget &&
      interactionMode === 'edit' &&
      activeTool !== undefined &&
      activeTool !== 'select' &&
      !pan;
    const selected = target && selectedKeys.has(`${target.kind}:${target.id}`);
    const modifiers = {
      shift: native.shiftKey,
      ctrl: native.ctrlKey,
      meta: native.metaKey,
    };
    const box =
      interactionMode === 'edit' &&
      activeTool === 'select' &&
      !pan &&
      !handle &&
      shouldStartBoxSelection(target, Boolean(selected), modifiers.shift);
    const edit =
      !handle &&
      !box &&
      !pan &&
      !create &&
      activeTool === 'select' &&
      (onObjectsMove || onObjectMove) &&
      target &&
      !modifiers.shift &&
      !modifiers.ctrl &&
      !modifiers.meta;
    const targets =
      edit && target ? (onObjectsMove && selected ? selection : [target]) : [];
    setMovingKeys(
      targets.length > 0 ? movedTargetKeys(snapshot, targets) : new Set(),
    );
    intentRef.current = {
      mode: pan
        ? 'pan'
        : create
          ? 'create'
          : handle
            ? 'handle'
            : box
              ? 'box'
              : edit
                ? 'edit'
                : 'pick',
      target,
      targets,
      selectionReady: Boolean(selected),
      lastScreen: point,
      modifiers,
      handleId: handle?.id,
    };
    setRenderIntent(intentRef.current);
    begin(native.pointerId, point, viewport);
  }

  function handlePointerMove(native: PointerEvent) {
    const point = pointerPoint(native);
    if (point) onPointerWorldMove?.(screenToWorld(viewportRef.current, point));
    if (point && !pointersRef.current.has(native.pointerId) && onHoverTarget) {
      onHoverTarget(
        hitTestHallScene(
          scene,
          screenToWorld(viewportRef.current, point),
          3 / viewportRef.current.scale,
        ),
      );
    }
    if (
      point &&
      !pointersRef.current.has(native.pointerId) &&
      editorMode &&
      activeTool === 'select'
    ) {
      setHoverTarget(
        hitTestHallScene(
          scene,
          screenToWorld(viewportRef.current, point),
          3 / viewportRef.current.scale,
        ),
      );
    }
    if (!point || !pointersRef.current.has(native.pointerId)) return;
    pointersRef.current.set(native.pointerId, point);
    if (pointersRef.current.size > 1) {
      const previous = pinchRef.current;
      const current = pinchGesture();
      if (previous && current) {
        const moved = panViewportBy(viewportRef.current, {
          x: current.center.x - previous.center.x,
          y: current.center.y - previous.center.y,
        });
        const next = zoomViewportAt(
          moved,
          current.center,
          previous.distance > 0 ? current.distance / previous.distance : 1,
        );
        viewportRef.current = next;
        setViewport(next);
      }
      pinchRef.current = current;
      return;
    }
    const previous = intentRef.current?.lastScreen ?? point;
    if (intentRef.current) intentRef.current.lastScreen = point;
    const next = move(native.pointerId, point, viewportRef.current);
    if (
      next?.dragging &&
      intentRef.current?.mode === 'edit' &&
      !intentRef.current.selectionReady &&
      intentRef.current.target
    ) {
      handleSelection([intentRef.current.target]);
      intentRef.current.selectionReady = true;
    }
    if (next?.dragging && intentRef.current?.mode === 'pan') {
      const moved = panViewportBy(viewportRef.current, {
        x: point.x - previous.x,
        y: point.y - previous.y,
      });
      viewportRef.current = moved;
      setViewport(moved);
    }
  }

  function handlePointerUp(native: PointerEvent) {
    const point = pointerPoint(native);
    pointersRef.current.delete(native.pointerId);
    if (pinchRef.current) {
      pinchRef.current = pointersRef.current.size > 1 ? pinchGesture() : null;
      cancel();
      setMovingKeys(new Set());
      intentRef.current = null;
      setRenderIntent(null);
      return;
    }
    const intent = intentRef.current;
    const result =
      point && finish(native.pointerId, point, viewportRef.current);
    intentRef.current = null;
    setRenderIntent(null);
    setMovingKeys(new Set());
    if (!point || !intent || !result) return;
    if (intent.mode === 'handle') {
      if (result.dragging && intent.target && intent.handleId)
        onHandleCommit?.(
          intent.target,
          intent.handleId,
          snapPoint(screenToWorld(viewportRef.current, point), gridEnabled),
        );
      return;
    }
    if (intent.mode === 'box') {
      if (result.dragging) {
        const end = screenToWorld(viewportRef.current, point);
        const bounds = {
          minX: Math.min(result.startWorld.x, end.x),
          minY: Math.min(result.startWorld.y, end.y),
          maxX: Math.max(result.startWorld.x, end.x),
          maxY: Math.max(result.startWorld.y, end.y),
        };
        const picked = boxSelectedTargets(scene, bounds);
        const additive =
          intent.modifiers.shift ||
          intent.modifiers.ctrl ||
          intent.modifiers.meta;
        const keys = new Set(
          selection.map((target) => `${target.kind}:${target.id}`),
        );
        handleSelection(
          additive
            ? [
                ...selection,
                ...picked.filter(
                  (target) => !keys.has(`${target.kind}:${target.id}`),
                ),
              ]
            : picked,
        );
        return;
      }
    }
    if (intent.mode === 'edit' && result.dragging) {
      if (!intent.selectionReady && intent.target)
        handleSelection([intent.target]);
      const delta = snappedMoveDelta(
        result.startWorld,
        result.delta,
        gridEnabled,
      );
      if (delta.x !== 0 || delta.y !== 0) {
        if (onObjectsMove) onObjectsMove(intent.targets, delta);
        else if (intent.target) onObjectMove?.(intent.target, delta);
      }
      return;
    }
    if (result.dragging || intent.mode === 'pan') return;
    const worldPoint = snapPoint(
      screenToWorld(viewportRef.current, point),
      gridEnabled && authoringMode,
    );
    if (intent.mode === 'create' || interactionMode === 'pick') {
      onCanvasClick?.(worldPoint, intent.target);
      return;
    }
    if (!intent.target) {
      handleSelection([]);
      return;
    }
    if (
      intent.modifiers.shift ||
      intent.modifiers.ctrl ||
      intent.modifiers.meta
    ) {
      const key = `${intent.target.kind}:${intent.target.id}`;
      handleSelection(
        selectedKeys.has(key)
          ? selection.filter((item) => `${item.kind}:${item.id}` !== key)
          : [...selection, intent.target],
      );
    } else handleSelection([intent.target]);
  }

  function handlePointerCancel(native: PointerEvent) {
    pointersRef.current.delete(native.pointerId);
    if (!cancel(native.pointerId)) return;
    setMovingKeys(new Set());
    intentRef.current = null;
    setRenderIntent(null);
    pinchRef.current = null;
  }

  function previewNode(key: string, node: ReactNode): ReactNode {
    return previewDelta && movingKeys?.has(key) ? (
      <DragPreview
        key={isValidElement(node) ? node.key : key}
        delta={previewDelta}
      >
        {node}
      </DragPreview>
    ) : (
      node
    );
  }

  // Keep the static elements stable while the drag preview redraws only overlays.
  const sceneObjectNodes = useMemo(() => {
    const nodes: { key: string; node: ReactNode }[] = [];
    for (const decoration of rendered.decorations) {
      nodes.push({
        key: `decoration:${decoration.id}`,
        node:
          decoration.kind === 'label' ? (
            <Text
              key={decoration.id}
              x={decoration.position.x}
              y={decoration.position.y}
              text={decoration.text}
              fontSize={1.2}
              fill={palette.ink}
            />
          ) : (
            <Group key={decoration.id}>
              <Line
                points={decoration.polygon.flatMap((point) => [
                  point.x,
                  point.y,
                ])}
                closed
                fill={decoration.kind === 'stage' ? '#c3a288' : '#787d83'}
                stroke={palette.ink}
                strokeWidth={0.14}
              />
              {decoration.label && (
                <Text
                  x={
                    decoration.polygon.reduce(
                      (sum, point) => sum + point.x,
                      0,
                    ) /
                      decoration.polygon.length -
                    3
                  }
                  y={
                    decoration.polygon.reduce(
                      (sum, point) => sum + point.y,
                      0,
                    ) /
                      decoration.polygon.length -
                    0.5
                  }
                  width={6}
                  align="center"
                  text={decoration.label}
                  fontSize={0.9}
                  fill={palette.ink}
                />
              )}
            </Group>
          ),
      });
    }
    if (showSeats) {
      for (const { row, points } of rendered.rows)
        nodes.push({
          key: `row:${row.id}`,
          node: (
            <Line
              key={row.id}
              points={points.flatMap((point) => [point.x, point.y])}
              stroke={palette.row}
              strokeWidth={0.15}
            />
          ),
        });
      for (const table of rendered.tables)
        nodes.push({
          key: `table:${table.id}`,
          node: (
            <ObjectRenderer
              key={table.id}
              object={table}
              colors={{ fill: palette.table, stroke: palette.row }}
              scale={viewport.scale}
            />
          ),
        });
    }
    if (dotBatches) {
      for (const batch of dotBatches)
        nodes.push({
          key: `dots:${batch.key}`,
          node: <DotSeatBatchShape key={`dots:${batch.key}`} batch={batch} />,
        });
    } else if (showSeats) {
      for (const seat of rendered.seats)
        nodes.push({
          key: `seat:${seat.id}`,
          node: (
            <ObjectRenderer
              key={seat.id}
              object={seat}
              colors={{
                fill: seatAppearance?.[seat.id]?.fill ?? palette.seat,
                stroke: seatAppearance?.[seat.id]?.stroke ?? palette.seatStroke,
              }}
              scale={viewport.scale}
            />
          ),
        });
    }
    if (showSeats) {
      for (const seat of rendered.seats) {
        if (visibleLabels.has(seat.id))
          nodes.push({
            key: `seat:${seat.id}`,
            node: <SeatLabel key={`label:${seat.id}`} seat={seat} />,
          });
      }
    }
    return nodes;
  }, [
    rendered,
    showSeats,
    dotBatches,
    visibleLabels,
    palette,
    seatAppearance,
    viewport.scale,
  ]);
  const staticSceneObjects = useMemo(
    () =>
      sceneObjectNodes
        .filter(({ key }) => !movingKeys.has(key))
        .map(({ node }) => node),
    [sceneObjectNodes, movingKeys],
  );
  const movingSceneObjects = useMemo(
    () => sceneObjectNodes.filter(({ key }) => movingKeys.has(key)),
    [sceneObjectNodes, movingKeys],
  );

  const selectedText = selection
    .map((target) => {
      switch (target.kind) {
        case 'seat':
          return scene.seatsById.get(target.id)?.label ?? target.id;
        case 'row':
          return scene.rowsById.get(target.id)?.row.name ?? target.id;
        case 'table':
          return scene.tablesById.get(target.id)?.label ?? target.id;
        case 'zone':
          return scene.zonesById.get(target.id)?.zone.name ?? target.id;
        case 'decoration': {
          const decoration = scene.decorationsById.get(target.id);
          return decoration?.kind === 'label'
            ? decoration.text
            : (decoration?.label ?? target.id);
        }
        default:
          return target.id;
      }
    })
    .join(', ');

  return (
    <section className="hall-viewer" aria-label={`${ui.hall} ${hallName}`}>
      <div
        className="hall-viewer-toolbar"
        role="toolbar"
        aria-label={ui.toolbar}
      >
        {interactionMode === 'view' && (
          <button
            type="button"
            aria-pressed={tool === 'select'}
            onClick={() => setLocalTool('select')}
          >
            {ui.select}
          </button>
        )}

        {interactionMode === 'view' && (
          <button
            type="button"
            aria-pressed={tool === 'pan'}
            onClick={() => setLocalTool('pan')}
          >
            {ui.pan}
          </button>
        )}

        <button
          type="button"
          aria-label={ui.zoomIn}
          onClick={() => handleZoom(1.25)}
        >
          +
        </button>

        <button
          type="button"
          aria-label={ui.zoomOut}
          onClick={() => handleZoom(0.8)}
        >
          −
        </button>

        <button type="button" onClick={handleFit}>
          {ui.fit}
        </button>

        <button type="button" onClick={handleReset}>
          {ui.reset}
        </button>

        <button
          type="button"
          disabled={selection.length === 0}
          onClick={handleZoomSelection}
        >
          {ui.zoomSelection}
        </button>

        {authoringMode && (
          <button
            type="button"
            aria-pressed={gridEnabled}
            onClick={() => setGridEnabled((current) => !current)}
          >
            {ui.grid}
          </button>
        )}

        <label>
          {ui.zone}{' '}
          <select
            aria-label={ui.zoomZone}
            defaultValue=""
            onChange={handleZoomZone}
          >
            <option value="">{ui.allZones}</option>
            {scene.zones.map(({ zone }) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>

        {snapshot.floors.length > 1 && (
          <label>
            {ui.floor}{' '}
            <select
              aria-label={ui.floor}
              value={activeFloorId}
              onChange={(event) => {
                setFloorId(event.target.value);
                onFloorChange?.(event.target.value);
                setViewport(
                  fitViewport(
                    buildHallScene(
                      snapshot,
                      event.target.value,
                      zoneBounds,
                      backgroundPages,
                    ).bounds,
                    width,
                    height,
                  ),
                );
                handleSelection([]);
              }}
            >
              {snapshot.floors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div
        ref={containerRef}
        className="hall-viewer-canvas"
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => handlePointerDown(event.nativeEvent)}
        onPointerMove={(event) => handlePointerMove(event.nativeEvent)}
        onPointerUp={(event) => handlePointerUp(event.nativeEvent)}
        onPointerCancel={(event) => handlePointerCancel(event.nativeEvent)}
        onLostPointerCapture={(event) => handlePointerCancel(event.nativeEvent)}
        onPointerLeave={() => {
          onPointerWorldMove?.(null);
          onHoverTarget?.(null);
          setHoverTarget(null);
        }}
        data-visible-seats={showSeats}
        data-preview-seats={previewSeats.length}
        data-floor-seat-count={scene.seats.length}
        data-seat-render-nodes={
          dotBatches?.length ?? (showSeats ? rendered.seats.length : 0)
        }
        data-viewport-x={viewport.x}
        data-viewport-y={viewport.y}
        data-viewport-scale={viewport.scale}
      >
        <HallStage
          ref={stageRef}
          id={stageId}
          width={width}
          height={height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          onWheel={handleWheel}
        >
          <Layer name="base" listening={false}>
            <Group name="background">
              {rendered.backgrounds.map(
                ({
                  background,
                  pageKey,
                  width: pageWidth,
                  height: pageHeight,
                }) => {
                  const canvas = backgroundPages?.[pageKey]?.canvas;
                  return canvas ? (
                    <KonvaImage
                      key={background.id}
                      image={canvas}
                      x={background.position.x}
                      y={background.position.y}
                      width={pageWidth * background.scale}
                      height={pageHeight * background.scale}
                      rotation={(background.rotationRadians * 180) / Math.PI}
                      opacity={background.opacity}
                    />
                  ) : null;
                },
              )}
            </Group>

            <Group name="grid">
              {gridLines.map((x) => (
                <Line
                  key={`x:${x}`}
                  points={[x, visibleWorld.minY, x, visibleWorld.maxY]}
                  stroke={palette.zoneStroke}
                  strokeWidth={Math.max(0.025, 0.5 / viewport.scale)}
                  opacity={0.35}
                />
              ))}
              {gridRows.map((y) => (
                <Line
                  key={`y:${y}`}
                  points={[visibleWorld.minX, y, visibleWorld.maxX, y]}
                  stroke={palette.zoneStroke}
                  strokeWidth={Math.max(0.025, 0.5 / viewport.scale)}
                  opacity={0.35}
                />
              ))}
            </Group>

            <Group name="static-geometry">
              <Rect
                x={displayScene.bounds.minX - 3}
                y={displayScene.bounds.minY - 3}
                width={displayScene.bounds.maxX - displayScene.bounds.minX + 6}
                height={displayScene.bounds.maxY - displayScene.bounds.minY + 6}
                stroke={palette.zoneStroke}
                strokeWidth={0.12}
                cornerRadius={0.8}
              />
            </Group>
          </Layer>

          <Layer name="zones" listening={false}>
            <Group name="zone-geometry">
              {rendered.zones.map(({ zone, bounds }) =>
                previewNode(
                  `zone:${zone.id}`,
                  zone.polygon ? (
                    <Line
                      key={zone.id}
                      points={zone.polygon.flatMap((point) => [
                        point.x,
                        point.y,
                      ])}
                      closed
                      fill={palette.zone}
                      stroke={palette.zoneStroke}
                      strokeWidth={0.12}
                    />
                  ) : (
                    <Rect
                      key={zone.id}
                      x={bounds.minX}
                      y={bounds.minY}
                      width={bounds.maxX - bounds.minX}
                      height={bounds.maxY - bounds.minY}
                      fill={palette.zone}
                      stroke={palette.zoneStroke}
                      strokeWidth={0.12}
                      cornerRadius={0.8}
                    />
                  ),
                ),
              )}
              {rendered.zones.map(({ zone, bounds }) =>
                previewNode(
                  `zone:${zone.id}`,
                  <Text
                    key={`label:${zone.id}`}
                    x={bounds.minX + 0.8}
                    y={bounds.minY + 0.55}
                    text={zone.name}
                    fill={palette.ink}
                    fontSize={1.15}
                  />,
                ),
              )}
            </Group>
          </Layer>

          <Layer name="objects" listening={false}>
            <Group name="rows-seats-tables">{staticSceneObjects}</Group>
          </Layer>

          <Layer name="overlays" listening={false}>
            <Group name="interaction" />
            <Group name="moving-objects">
              {movingSceneObjects.map(({ key, node }) =>
                previewNode(key, node),
              )}
            </Group>

            <Group name="generation-preview">
              {previewSeats.map((seat, index) => (
                <Circle
                  key={index}
                  x={seat.x}
                  y={seat.y}
                  radius={0.7}
                  fill="#f8b84e"
                  stroke="#8b5600"
                  strokeWidth={0.15}
                  opacity={0.65}
                />
              ))}
            </Group>

            <Group name="selection">
              {selection.flatMap((target) => {
                const bounds = targetBounds(displayScene, target);
                return bounds
                  ? [
                      previewNode(
                        `${target.kind}:${target.id}`,
                        <SelectionOverlay
                          key={`${target.kind}:${target.id}`}
                          bounds={bounds}
                          color={palette.selected}
                        />,
                      ),
                    ]
                  : [];
              })}
            </Group>

            <Group name="guides">
              {hoverTarget &&
                !selectedKeys.has(`${hoverTarget.kind}:${hoverTarget.id}`) &&
                (() => {
                  const bounds = targetBounds(displayScene, hoverTarget);
                  return bounds ? (
                    <SelectionOverlay bounds={bounds} color={palette.row} />
                  ) : null;
                })()}
              {boxBounds && (
                <Rect
                  x={boxBounds.minX}
                  y={boxBounds.minY}
                  width={boxBounds.maxX - boxBounds.minX}
                  height={boxBounds.maxY - boxBounds.minY}
                  fill={palette.selected}
                  opacity={0.12}
                  stroke={palette.selected}
                  strokeWidth={0.12}
                />
              )}
              {positionedHandles.map((handle) =>
                handle.id.startsWith('bounds:') ? (
                  <Rect
                    key={`${handle.target.kind}:${handle.target.id}:${handle.id}`}
                    x={handle.point.x - Math.max(0.16, 5 / viewport.scale)}
                    y={handle.point.y - Math.max(0.16, 5 / viewport.scale)}
                    width={Math.max(0.32, 10 / viewport.scale)}
                    height={Math.max(0.32, 10 / viewport.scale)}
                    cornerRadius={0.06}
                    fill="#fff"
                    stroke={palette.selected}
                    strokeWidth={Math.max(0.06, 1 / viewport.scale)}
                  />
                ) : (
                  <Circle
                    key={`${handle.target.kind}:${handle.target.id}:${handle.id}`}
                    x={handle.point.x}
                    y={handle.point.y}
                    radius={Math.max(0.15, 6 / viewport.scale)}
                    fill={palette.selected}
                    stroke={palette.ink}
                    strokeWidth={Math.max(0.06, 1 / viewport.scale)}
                  />
                ),
              )}
              {calibrationGuide && (
                <Line
                  points={[
                    calibrationGuide.first.x,
                    calibrationGuide.first.y,
                    calibrationGuide.second.x,
                    calibrationGuide.second.y,
                  ]}
                  stroke={palette.selected}
                  strokeWidth={Math.max(0.1, 2 / viewport.scale)}
                  dash={[0.4, 0.3]}
                />
              )}
              {gridEnabled &&
                preview?.dragging &&
                (renderIntent?.mode === 'edit' ||
                  renderIntent?.mode === 'handle' ||
                  renderIntent?.mode === 'create') &&
                (() => {
                  const point = snapPoint(
                    screenToWorld(viewport, preview.screen),
                    true,
                  );
                  return (
                    <Group>
                      <Line
                        points={[
                          point.x,
                          visibleWorld.minY,
                          point.x,
                          visibleWorld.maxY,
                        ]}
                        stroke={palette.selected}
                        strokeWidth={0.06}
                        dash={[0.3, 0.2]}
                      />
                      <Line
                        points={[
                          visibleWorld.minX,
                          point.y,
                          visibleWorld.maxX,
                          point.y,
                        ]}
                        stroke={palette.selected}
                        strokeWidth={0.06}
                        dash={[0.3, 0.2]}
                      />
                    </Group>
                  );
                })()}
            </Group>
          </Layer>
        </HallStage>
      </div>

      <div className="hall-viewer-status" aria-live="polite">
        <span>
          {ui.scale}: {Math.round(viewport.scale * 100)}%
        </span>

        <span>
          {ui.selected}: {selection.length}
          {selectedText ? ` — ${selectedText}` : ''}
        </span>
      </div>
    </section>
  );
}

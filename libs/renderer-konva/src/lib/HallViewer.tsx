import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import type { LayoutSnapshot } from '@hall-platform/domain';
import type { SpatialBounds, Vector2 } from '@hall-platform/geometry';
import type Konva from 'konva';
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Text,
} from 'react-konva';

import { HallStage } from './HallStage.js';
import {
  buildHallScene,
  hitTestHallScene,
  selectionBounds,
  targetBounds,
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
  readonly activeTool?: string;
  readonly selectedTargets?: readonly HallTarget[];
  readonly onCanvasClick?: (point: Vector2, target: HallTarget | null) => void;
  readonly onObjectMove?: (target: HallTarget, delta: Vector2) => void;
  readonly onObjectsMove?: (
    targets: readonly HallTarget[],
    delta: Vector2,
  ) => void;
  readonly onSelectionChange?: (selection: readonly HallTarget[]) => void;
  readonly onFloorChange?: (floorId: string) => void;
};

type PointerMode = 'pan' | 'pick' | 'edit' | 'create';
type PointerIntent = {
  mode: PointerMode;
  target: HallTarget | null;
  targets: readonly HallTarget[];
  selectionReady: boolean;
  lastScreen: Vector2;
  modifiers: { shift: boolean; ctrl: boolean; meta: boolean };
};

const palette = {
  ink: '#193047',
  seat: '#2079a8',
  seatStroke: '#145577',
  zone: '#e7f2f8',
  zoneStroke: '#91b4ca',
  row: '#65869b',
  table: '#c3dbe6',
  selected: '#ed8936',
};
const farZoomTargets = new Set<HallTarget['kind']>(['zone']);
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
    activeTool,
    selectedTargets,
    onCanvasClick,
    onObjectMove,
    onObjectsMove,
    onSelectionChange,
    onFloorChange,
  } = props;
  const ui = { ...defaultLabels, ...labels };
  const [floorId, setFloorId] = useState(snapshot.floors[0]?.id ?? '');
  const [width, setWidth] = useState(900);
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
  const tool =
    activeTool === undefined
      ? localTool
      : activeTool === 'pan'
        ? 'pan'
        : 'select';
  const containerRef = useRef<HTMLDivElement>(null);
  const observedWidth = useRef(width);
  const sceneRef = useRef(scene);
  const previousFitKey = useRef(fitKey);
  const stageRef = useRef<Konva.Stage>(null);
  const { preview, begin, move, finish, cancel } = usePointerInteraction();
  const [movingKeys, setMovingKeys] = useState<ReadonlySet<string>>(new Set());
  const intentRef = useRef<PointerIntent | null>(null);
  const pointersRef = useRef(new Map<number, Vector2>());
  const pinchRef = useRef<{ center: Vector2; distance: number } | null>(null);
  const viewportRef = useRef(viewport);
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
  const editorMode = activeTool !== undefined;
  const showSeats = editorMode || viewport.scale >= 4;
  const showLabels = viewport.scale >= 17;

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
      pinchRef.current = pinchGesture();
      return;
    }
    const target = hitTestHallScene(
      scene,
      screenToWorld(viewport, point),
      3 / viewport.scale,
      showSeats ? undefined : farZoomTargets,
    );
    const pan = tool === 'pan' || native.button === 1 || native.altKey;
    const create = activeTool !== undefined && activeTool !== 'select' && !pan;
    const selected = target && selectedKeys.has(`${target.kind}:${target.id}`);
    const modifiers = {
      shift: native.shiftKey,
      ctrl: native.ctrlKey,
      meta: native.metaKey,
    };
    const edit =
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
      mode: pan ? 'pan' : create ? 'create' : edit ? 'edit' : 'pick',
      target,
      targets,
      selectionReady: Boolean(selected),
      lastScreen: point,
      modifiers,
    };
    begin(native.pointerId, point, viewport);
  }

  function handlePointerMove(native: PointerEvent) {
    const point = pointerPoint(native);
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
      return;
    }
    const intent = intentRef.current;
    const result =
      point && finish(native.pointerId, point, viewportRef.current);
    intentRef.current = null;
    setMovingKeys(new Set());
    if (!point || !intent || !result) return;
    if (intent.mode === 'edit' && result.dragging) {
      if (!intent.selectionReady && intent.target)
        handleSelection([intent.target]);
      if (result.delta.x !== 0 || result.delta.y !== 0) {
        if (onObjectsMove) onObjectsMove(intent.targets, result.delta);
        else if (intent.target) onObjectMove?.(intent.target, result.delta);
      }
      return;
    }
    if (result.dragging || intent.mode === 'pan') return;
    const worldPoint = screenToWorld(viewportRef.current, point);
    if (intent.mode === 'create') {
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
    pinchRef.current = null;
  }

  const previewDelta = preview && movingKeys.size > 0 ? preview.delta : null;
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

  const selectedText = selection
    .map((target) => {
      switch (target.kind) {
        case 'seat':
          return (
            scene.seats.find((seat) => seat.id === target.id)?.label ??
            target.id
          );
        case 'row':
          return (
            scene.rows.find(({ row }) => row.id === target.id)?.row.name ??
            target.id
          );
        case 'table':
          return (
            scene.tables.find((table) => table.id === target.id)?.label ??
            target.id
          );
        case 'zone':
          return (
            scene.zones.find(({ zone }) => zone.id === target.id)?.zone.name ??
            target.id
          );
        case 'decoration': {
          const decoration = scene.decorations.find(
            (item) => item.id === target.id,
          );
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
        {activeTool === undefined && (
          <button
            type="button"
            aria-pressed={tool === 'select'}
            onClick={() => setLocalTool('select')}
          >
            {ui.select}
          </button>
        )}

        {activeTool === undefined && (
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
        data-visible-seats={showSeats}
        data-preview-seats={previewSeats.length}
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
              {scene.backgrounds.map(
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

            <Group name="static-geometry">
              <Rect
                x={scene.bounds.minX - 3}
                y={scene.bounds.minY - 3}
                width={scene.bounds.maxX - scene.bounds.minX + 6}
                height={scene.bounds.maxY - scene.bounds.minY + 6}
                stroke={palette.zoneStroke}
                strokeWidth={0.12}
                cornerRadius={0.8}
              />
            </Group>
          </Layer>

          <Layer name="zones" listening={false}>
            <Group name="zone-geometry">
              {scene.zones.map(({ zone, bounds }) =>
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
              {scene.zones.map(({ zone, bounds }) =>
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
            <Group name="rows-seats-tables">
              {scene.decorations.map((decoration) =>
                previewNode(
                  `decoration:${decoration.id}`,
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
                        fill={
                          decoration.kind === 'stage' ? '#c3a288' : '#787d83'
                        }
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
                ),
              )}
              {showSeats &&
                scene.rows.map(({ row, points }) =>
                  previewNode(
                    `row:${row.id}`,
                    <Line
                      key={row.id}
                      points={points.flatMap((point) => [point.x, point.y])}
                      stroke={palette.row}
                      strokeWidth={0.15}
                    />,
                  ),
                )}
              {showSeats &&
                scene.tables.map((table) =>
                  previewNode(
                    `table:${table.id}`,
                    table.shape.kind === 'circle' ? (
                      <Circle
                        key={table.id}
                        x={table.center.x}
                        y={table.center.y}
                        radius={table.shape.radius}
                        fill={palette.table}
                        stroke={palette.row}
                        strokeWidth={0.14}
                      />
                    ) : (
                      <Rect
                        key={table.id}
                        x={table.center.x}
                        y={table.center.y}
                        offsetX={table.shape.width / 2}
                        offsetY={table.shape.height / 2}
                        width={table.shape.width}
                        height={table.shape.height}
                        rotation={(table.rotationRadians * 180) / Math.PI}
                        fill={palette.table}
                        stroke={palette.row}
                        strokeWidth={0.14}
                      />
                    ),
                  ),
                )}
              {showSeats &&
                scene.seats.map((seat) =>
                  previewNode(
                    `seat:${seat.id}`,
                    <Circle
                      key={seat.id}
                      x={seat.position.x}
                      y={seat.position.y}
                      radius={
                        editorMode ? Math.max(0.65, 4 / viewport.scale) : 0.65
                      }
                      fill={seatAppearance?.[seat.id]?.fill ?? palette.seat}
                      stroke={
                        seatAppearance?.[seat.id]?.stroke ?? palette.seatStroke
                      }
                      strokeWidth={0.11}
                    />,
                  ),
                )}
              {showLabels &&
                scene.seats.map((seat) =>
                  previewNode(
                    `seat:${seat.id}`,
                    <Text
                      key={`label:${seat.id}`}
                      x={seat.position.x - 1}
                      y={seat.position.y - 0.28}
                      width={2}
                      align="center"
                      text={seat.label}
                      fill="white"
                      fontSize={0.52}
                    />,
                  ),
                )}
            </Group>
          </Layer>

          <Layer name="overlays" listening={false}>
            <Group name="interaction" />

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
                const bounds = targetBounds(scene, target);
                return bounds
                  ? [
                      previewNode(
                        `${target.kind}:${target.id}`,
                        <Rect
                          key={`${target.kind}:${target.id}`}
                          x={bounds.minX - 0.2}
                          y={bounds.minY - 0.2}
                          width={bounds.maxX - bounds.minX + 0.4}
                          height={bounds.maxY - bounds.minY + 0.4}
                          stroke={palette.selected}
                          strokeWidth={0.2}
                          cornerRadius={0.3}
                        />,
                      ),
                    ]
                  : [];
              })}
            </Group>

            <Group name="guides" />
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

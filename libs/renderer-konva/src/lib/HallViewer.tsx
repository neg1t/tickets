import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
  readonly onSelectionChange?: (selection: readonly HallTarget[]) => void;
  readonly onFloorChange?: (floorId: string) => void;
};

type TouchGesture = { x: number; y: number; distance: number };

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
    zoneBounds,
    backgroundPages,
    activeTool,
    selectedTargets,
    onCanvasClick,
    onObjectMove,
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
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const objectDragRef = useRef<{ point: Vector2; target: HallTarget } | null>(
    null,
  );
  const draggedRef = useRef(false);
  const touchRef = useRef<TouchGesture | null>(null);

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
    setViewport((current) => zoomViewportAt(current, point, factor));
  }

  function handleMouseDown(event: Konva.KonvaEventObject<MouseEvent>) {
    if (event.evt.button !== 0 && event.evt.button !== 1) return;
    if (tool === 'pan' || event.evt.button === 1 || event.evt.altKey) {
      const point = stageRef.current?.getPointerPosition();
      if (point) dragRef.current = point;
      draggedRef.current = false;
    } else if (activeTool === 'select' && onObjectMove) {
      const point = stageRef.current?.getPointerPosition();
      if (!point) return;
      const target = hitTestHallScene(
        scene,
        screenToWorld(viewport, point),
        3 / viewport.scale,
      );
      if (target) objectDragRef.current = { point, target };
      draggedRef.current = false;
    }
  }

  function handleMouseMove() {
    const point = stageRef.current?.getPointerPosition();
    if (point && objectDragRef.current) {
      const start = objectDragRef.current.point;
      if (Math.hypot(point.x - start.x, point.y - start.y) > 3)
        draggedRef.current = true;
      return;
    }
    const previous = dragRef.current;
    if (!point || !previous) return;
    const delta = { x: point.x - previous.x, y: point.y - previous.y };
    if (Math.abs(delta.x) + Math.abs(delta.y) > 0) {
      draggedRef.current = true;
      setViewport((current) => panViewportBy(current, delta));
      dragRef.current = point;
    }
  }

  function handleMouseUp() {
    const objectDrag = objectDragRef.current;
    const point = stageRef.current?.getPointerPosition();
    if (objectDrag && point && draggedRef.current) {
      onObjectMove?.(objectDrag.target, {
        x: (point.x - objectDrag.point.x) / viewport.scale,
        y: (point.y - objectDrag.point.y) / viewport.scale,
      });
    }
    objectDragRef.current = null;
    dragRef.current = null;
  }

  function handleClick(event: Konva.KonvaEventObject<MouseEvent>) {
    if (tool === 'pan' || draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const screen = stageRef.current?.getPointerPosition();
    if (!screen) return;
    const worldPoint = screenToWorld(viewport, screen);
    const target = hitTestHallScene(
      scene,
      worldPoint,
      3 / viewport.scale,
      showSeats ? undefined : farZoomTargets,
    );
    if (activeTool && activeTool !== 'select' && activeTool !== 'pan') {
      onCanvasClick?.(worldPoint, target);
      return;
    }
    if (!target) {
      handleSelection([]);
      return;
    }
    if (event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey) {
      const key = `${target.kind}:${target.id}`;
      handleSelection(
        selectedKeys.has(key)
          ? selection.filter((item) => `${item.kind}:${item.id}` !== key)
          : [...selection, target],
      );
    } else {
      handleSelection([target]);
    }
  }

  function readTouchGesture(touches: TouchList): TouchGesture | null {
    const rect = containerRef.current?.getBoundingClientRect();
    const first = touches[0];
    if (!rect || !first) return null;
    const second = touches[1];
    if (!second)
      return {
        x: first.clientX - rect.left,
        y: first.clientY - rect.top,
        distance: 0,
      };
    const x = (first.clientX + second.clientX) / 2 - rect.left;
    const y = (first.clientY + second.clientY) / 2 - rect.top;
    return {
      x,
      y,
      distance: Math.hypot(
        first.clientX - second.clientX,
        first.clientY - second.clientY,
      ),
    };
  }

  function handleTouchStart(event: Konva.KonvaEventObject<TouchEvent>) {
    touchRef.current = readTouchGesture(event.evt.touches);
  }

  function handleTouchMove(event: Konva.KonvaEventObject<TouchEvent>) {
    event.evt.preventDefault();
    const current = readTouchGesture(event.evt.touches);
    const previous = touchRef.current;
    if (!current || !previous) return;
    setViewport((before) => {
      const moved = panViewportBy(before, {
        x: current.x - previous.x,
        y: current.y - previous.y,
      });
      return current.distance > 0 && previous.distance > 0
        ? zoomViewportAt(
            moved,
            { x: current.x, y: current.y },
            current.distance / previous.distance,
          )
        : moved;
    });
    touchRef.current = current;
  }

  function handleTouchEnd(event: Konva.KonvaEventObject<TouchEvent>) {
    touchRef.current = readTouchGesture(event.evt.touches);
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
        data-visible-seats={showSeats}
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
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
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
              {scene.zones.map(({ zone, bounds }) => (
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
              ))}
              {scene.zones.map(({ zone, bounds }) => (
                <Text
                  key={`label:${zone.id}`}
                  x={bounds.minX + 0.8}
                  y={bounds.minY + 0.55}
                  text={zone.name}
                  fill={palette.ink}
                  fontSize={1.15}
                />
              ))}
            </Group>
          </Layer>

          <Layer name="objects" listening={false}>
            <Group name="rows-seats-tables">
              {showSeats &&
                scene.rows.map(({ row, points }) => (
                  <Line
                    key={row.id}
                    points={points.flatMap((point) => [point.x, point.y])}
                    stroke={palette.row}
                    strokeWidth={0.15}
                  />
                ))}
              {showSeats &&
                scene.tables.map((table) =>
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
                )}
              {showSeats &&
                scene.seats.map((seat) => (
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
                  />
                ))}
              {showLabels &&
                scene.seats.map((seat) => (
                  <Text
                    key={`label:${seat.id}`}
                    x={seat.position.x - 1}
                    y={seat.position.y - 0.28}
                    width={2}
                    align="center"
                    text={seat.label}
                    fill="white"
                    fontSize={0.52}
                  />
                ))}
            </Group>
          </Layer>

          <Layer name="overlays" listening={false}>
            <Group name="interaction" />

            <Group name="selection">
              {selection.flatMap((target) => {
                const bounds = targetBounds(scene, target);
                return bounds
                  ? [
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

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createSeatScene,
  type RendererSeatPositionUpdate,
  type RendererSeatUpdate,
  type Viewport,
} from '@hall-platform/renderer-core';
import {
  HallViewer,
  type HallTarget,
  type HallViewerProps,
} from '@hall-platform/renderer-konva';
import {
  selectRendererEngine,
  type RendererPreference,
} from './rendererSelection.js';
import { WebGLErrorBoundary } from './WebGLErrorBoundary.js';

const LazyWebGLHallCanvas = lazy(async () => {
  const module = await import('@hall-platform/renderer-webgl');
  return { default: module.WebGLHallCanvas };
});

const noSeatUpdates: readonly RendererSeatUpdate[] = [];

export type HallViewportProps = Omit<
  HallViewerProps,
  | 'hideSeatShapes'
  | 'seatRendererLayer'
  | 'onViewportChange'
  | 'onSeatPreviewChange'
> & {
  readonly renderer?: RendererPreference;
  readonly webglEnabled?: boolean;
  readonly seatUpdates?: readonly RendererSeatUpdate[];
  readonly onRendererChange?: (renderer: 'canvas' | 'webgl') => void;
  readonly onRendererError?: (error: Error) => void;
};

export function HallViewport(props: HallViewportProps) {
  const {
    snapshot,
    focusedFloorId: requestedFloorId,
    onFloorChange,
    selectedTargets: controlledSelection,
    renderer = 'auto',
    webglEnabled = false,
    seatUpdates,
    onRendererChange,
    onRendererError,
  } = props;
  const [localFloorId, setLocalFloorId] = useState(
    requestedFloorId ?? snapshot.floors[0]?.id ?? '',
  );
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [webglReadyKey, setWebglReadyKey] = useState('');
  const contextLosses = useRef(0);
  const [hoveredTarget, setHoveredTarget] = useState<HallTarget | null>(null);
  const [localSelection, setLocalSelection] = useState<HallTarget[]>([]);
  const [previewPositions, setPreviewPositions] = useState<
    readonly RendererSeatPositionUpdate[]
  >([]);
  const selectedTargets = controlledSelection ?? localSelection;
  const preferredFloorId = requestedFloorId ?? localFloorId;
  const floorId = snapshot.floors.some((floor) => floor.id === preferredFloorId)
    ? preferredFloorId
    : (snapshot.floors[0]?.id ?? '');
  const engine = selectRendererEngine(renderer, webglEnabled, webglFailed);
  const rendererKey = `${renderer}:${webglEnabled}`;
  const webglReady = engine === 'webgl' && webglReadyKey === rendererKey;
  const seatScene = useMemo(
    () =>
      createSeatScene(
        1,
        snapshot.seats
          .filter((seat) => seat.floorId === floorId)
          .map((seat) => ({
            id: seat.id,
            floorId: seat.floorId,
            position: seat.position,
            ...(seat.rotationRadians !== undefined
              ? { rotationRadians: seat.rotationRadians }
              : {}),
            ...(seat.visualKind !== undefined
              ? { visualKind: seat.visualKind }
              : {}),
          })),
        floorId,
      ),
    [snapshot.seats, floorId],
  );
  const effectiveSeatUpdates = useMemo(
    () =>
      seatUpdates ??
      (engine === 'webgl'
        ? snapshot.seats.map((seat) => ({
            id: seat.id,
            status: 'available',
            label: seat.label,
          }))
        : noSeatUpdates),
    [seatUpdates, snapshot.seats, engine],
  );
  const selection = useMemo(() => {
    const targets = new Map(
      selectedTargets.map((target) => [
        `${target.kind}:${target.id}`,
        { kind: target.kind, id: target.id },
      ]),
    );
    if (hoveredTarget?.kind === 'seat')
      targets.set(`seat:${hoveredTarget.id}`, {
        kind: 'seat',
        id: hoveredTarget.id,
      });
    return [...targets.values()];
  }, [selectedTargets, hoveredTarget]);
  const handleViewportChange = useCallback((next: Viewport) => {
    setViewport(next);
  }, []);
  const handleFloorChange = useCallback(
    (next: string) => {
      setLocalFloorId(next);
      onFloorChange?.(next);
    },
    [onFloorChange],
  );
  const handleSelectionChange = useCallback(
    (next: readonly HallTarget[]) => {
      if (controlledSelection === undefined) setLocalSelection([...next]);
      props.onSelectionChange?.(next);
    },
    [controlledSelection, props.onSelectionChange],
  );
  const handleHoverTarget = useCallback(
    (target: HallTarget | null) => {
      setHoveredTarget(target);
      props.onHoverTarget?.(target);
    },
    [props.onHoverTarget],
  );
  const handleWebGLError = useCallback(
    (error: Error) => {
      setWebglFailed(true);
      onRendererError?.(error);
    },
    [onRendererError],
  );
  const handleContextLost = useCallback(() => {
    contextLosses.current += 1;
    if (contextLosses.current > 1) setWebglFailed(true);
  }, []);
  const handleRendererReady = useCallback(() => {
    setWebglReadyKey(rendererKey);
  }, [rendererKey]);
  const rendererLayer =
    engine === 'webgl' && viewport ? (
      <WebGLErrorBoundary key={renderer} onError={handleWebGLError}>
        <Suspense fallback={null}>
          <LazyWebGLHallCanvas
            scene={seatScene}
            viewport={viewport}
            seatUpdates={effectiveSeatUpdates}
            previewPositions={previewPositions}
            selection={selection}
            onContextLost={handleContextLost}
            onRendererError={handleWebGLError}
            onRendererReady={handleRendererReady}
          />
        </Suspense>
      </WebGLErrorBoundary>
    ) : null;

  useEffect(() => {
    contextLosses.current = 0;
    setWebglFailed(false);
  }, [renderer, webglEnabled]);
  useEffect(() => {
    if (snapshot.floors.some((floor) => floor.id === localFloorId)) return;
    setLocalFloorId(snapshot.floors[0]?.id ?? '');
  }, [snapshot.floors, localFloorId]);
  useEffect(() => {
    if (requestedFloorId !== undefined) setLocalFloorId(requestedFloorId);
  }, [requestedFloorId]);
  useEffect(() => onRendererChange?.(engine), [engine, onRendererChange]);

  return (
    <HallViewer
      {...props}
      focusedFloorId={floorId}
      onFloorChange={handleFloorChange}
      selectedTargets={selectedTargets}
      onSelectionChange={handleSelectionChange}
      onHoverTarget={handleHoverTarget}
      onViewportChange={handleViewportChange}
      onSeatPreviewChange={setPreviewPositions}
      hideSeatShapes={webglReady}
      seatRendererLayer={rendererLayer}
    />
  );
}

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  CameraController,
  createSeatScene,
  defaultViewport,
  type RendererScene,
  type RendererSeatGeometry,
  type RendererSeatPositionUpdate,
  type RendererSeatUpdate,
  type HallTarget,
} from '@hall-platform/renderer-core';
import {
  defaultHallCanvasPalette,
  type HallCanvasPalette,
} from '@hall-platform/design-tokens';
import {
  HallViewer,
  type HallViewerProps,
} from '@hall-platform/renderer-konva';
import {
  scheduleRendererScenePreparation,
  selectRendererEngine,
  type RendererPreference,
} from './rendererSelection.js';
import { WebGLErrorBoundary } from './WebGLErrorBoundary.js';

const LazyWebGLHallCanvas = lazy(async () => {
  const module = await import('@hall-platform/renderer-webgl');
  return { default: module.WebGLHallCanvas };
});

const noSeatUpdates: readonly RendererSeatUpdate[] = [];

type PreparedSeatScene = Readonly<{
  seats: HallViewportProps['snapshot']['seats'];
  floorId: string;
  scene: RendererScene<RendererSeatGeometry>;
}>;

export type HallViewportProps = Omit<
  HallViewerProps,
  | 'hideSeatShapes'
  | 'seatRendererLayer'
  | 'rendererEngine'
  | 'cameraController'
  | 'onSeatFillColorChange'
  | 'onRendererPaletteChange'
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
    seatAppearance,
    renderer = 'auto',
    webglEnabled = false,
    seatUpdates,
    onRendererChange,
    onRendererError,
    onSelectionChange: onSelectionChangeProp,
    onHoverTarget: onHoverTargetProp,
  } = props;
  const [localFloorId, setLocalFloorId] = useState(
    requestedFloorId ?? snapshot.floors[0]?.id ?? '',
  );
  const [cameraController] = useState(
    () =>
      new CameraController(
        defaultViewport,
        (callback) => requestAnimationFrame(callback),
        (frame) => cancelAnimationFrame(frame),
      ),
  );
  const rendererSessionId = useId();
  const sceneRevisionRef = useRef(0);
  const viewport = useSyncExternalStore(
    cameraController.subscribe,
    cameraController.getSnapshot,
    cameraController.getSnapshot,
  );
  const [webglFailureKey, setWebglFailureKey] = useState<string | null>(null);
  const [preparedSeatScene, setPreparedSeatScene] =
    useState<PreparedSeatScene | null>(null);
  const [webglReadyScene, setWebglReadyScene] =
    useState<RendererScene<RendererSeatGeometry> | null>(null);
  const [canvasPalette, setCanvasPalette] = useState(defaultHallCanvasPalette);
  const [contextFallbackState, setContextFallbackState] = useState<{
    rendererKey: string;
    sceneRevision: number | null;
    contextLost: boolean;
    restorePending: boolean;
  }>({
    rendererKey: '',
    sceneRevision: null,
    contextLost: false,
    restorePending: false,
  });
  const [localSelection, setLocalSelection] = useState<HallTarget[]>([]);
  const [previewPositions, setPreviewPositions] = useState<
    readonly RendererSeatPositionUpdate[]
  >([]);
  const selectedTargets = controlledSelection ?? localSelection;
  const preferredFloorId = requestedFloorId ?? localFloorId;
  const floorId = snapshot.floors.some((floor) => floor.id === preferredFloorId)
    ? preferredFloorId
    : (snapshot.floors[0]?.id ?? '');
  const rendererKey = `${renderer}:${webglEnabled}`;
  const webglFailed = webglFailureKey === rendererKey;
  const engine = selectRendererEngine(renderer, webglEnabled, webglFailed);
  const seatScene =
    preparedSeatScene?.seats === snapshot.seats &&
    preparedSeatScene.floorId === floorId
      ? preparedSeatScene.scene
      : null;
  const webglContextLost =
    seatScene !== null &&
    contextFallbackState.rendererKey === rendererKey &&
    contextFallbackState.sceneRevision === seatScene.revision &&
    contextFallbackState.contextLost;
  const webglReady =
    engine === 'webgl' && seatScene !== null && webglReadyScene === seatScene;
  const effectiveSeatUpdates = useMemo(() => {
    const updates: readonly RendererSeatUpdate[] =
      seatUpdates ??
      (engine === 'webgl'
        ? snapshot.seats.map((seat) => ({
            id: seat.id,
            status: 'available',
            label: seat.label,
          }))
        : noSeatUpdates);
    if (engine !== 'webgl') return updates;
    return updates.map((update) => ({
      ...update,
      fillColor:
        seatAppearance?.[update.id]?.fill ??
        update.fillColor ??
        canvasPalette.seat,
      strokeColor:
        seatAppearance?.[update.id]?.stroke ??
        update.strokeColor ??
        canvasPalette.seatStroke,
    }));
  }, [
    seatUpdates,
    snapshot.seats,
    engine,
    seatAppearance,
    canvasPalette.seat,
    canvasPalette.seatStroke,
  ]);
  const selection = useMemo(() => {
    return selectedTargets.map((target) => ({
      kind: target.kind,
      id: target.id,
    }));
  }, [selectedTargets]);
  const handleRendererPaletteChange = useCallback(
    (palette: HallCanvasPalette) => setCanvasPalette(palette),
    [],
  );
  const handleFloorChange = useCallback(
    (next: string) => {
      if (requestedFloorId === undefined) setLocalFloorId(next);
      onFloorChange?.(next);
    },
    [onFloorChange, requestedFloorId],
  );
  const handleSelectionChange = useCallback(
    (next: readonly HallTarget[]) => {
      if (controlledSelection === undefined) setLocalSelection([...next]);
      onSelectionChangeProp?.(next);
    },
    [controlledSelection, onSelectionChangeProp],
  );
  const handleHoverTarget = useCallback(
    (target: HallTarget | null) => {
      onHoverTargetProp?.(target);
    },
    [onHoverTargetProp],
  );
  const handleWebGLError = useCallback(
    (error: Error) => {
      setWebglFailureKey(rendererKey);
      onRendererError?.(error);
    },
    [onRendererError, rendererKey],
  );
  const handleContextLost = useCallback(() => {
    setContextFallbackState({
      rendererKey,
      sceneRevision: seatScene?.revision ?? null,
      contextLost: true,
      restorePending: false,
    });
  }, [rendererKey, seatScene]);
  const handleContextRestored = useCallback(() => {
    setContextFallbackState({
      rendererKey,
      sceneRevision: seatScene?.revision ?? null,
      contextLost: true,
      restorePending: true,
    });
  }, [rendererKey, seatScene]);
  const handleFrameRendered = useCallback(() => {
    if (seatScene) setWebglReadyScene(seatScene);
    setContextFallbackState((current) =>
      current.rendererKey === rendererKey &&
      current.sceneRevision === (seatScene?.revision ?? null) &&
      current.restorePending
        ? {
            rendererKey,
            sceneRevision: seatScene?.revision ?? null,
            contextLost: false,
            restorePending: false,
          }
        : current,
    );
  }, [rendererKey, seatScene]);
  const rendererLayer =
    engine === 'webgl' && viewport && seatScene ? (
      <WebGLErrorBoundary key={rendererKey} onError={handleWebGLError}>
        <Suspense fallback={null}>
          <LazyWebGLHallCanvas
            scene={seatScene}
            viewport={viewport}
            cameraController={cameraController}
            seatUpdates={effectiveSeatUpdates}
            previewPositions={previewPositions}
            selection={selection}
            selectedColor={canvasPalette.selected}
            onContextLost={handleContextLost}
            onContextRestored={handleContextRestored}
            onRendererError={handleWebGLError}
            onFrameRendered={handleFrameRendered}
          />
        </Suspense>
      </WebGLErrorBoundary>
    ) : null;

  useEffect(() => {
    const seats = snapshot.seats;
    const requestedFloorId = floorId;
    return scheduleRendererScenePreparation(
      engine,
      () =>
        createSeatScene(
          ++sceneRevisionRef.current,
          seats.map((seat) => ({
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
          requestedFloorId,
          { documentId: snapshot.id, sessionId: rendererSessionId },
        ),
      (scene) =>
        setPreparedSeatScene({
          seats,
          floorId: requestedFloorId,
          scene,
        }),
    );
  }, [engine, rendererSessionId, snapshot.id, snapshot.seats, floorId]);
  useEffect(() => onRendererChange?.(engine), [engine, onRendererChange]);

  return (
    <HallViewer
      {...props}
      focusedFloorId={floorId}
      onFloorChange={handleFloorChange}
      selectedTargets={selectedTargets}
      onSelectionChange={handleSelectionChange}
      onHoverTarget={handleHoverTarget}
      cameraController={cameraController}
      onRendererPaletteChange={handleRendererPaletteChange}
      onSeatPreviewChange={setPreviewPositions}
      hideSeatShapes={webglReady && !webglContextLost}
      seatRendererLayer={rendererLayer}
      rendererEngine={webglReady && !webglContextLost ? 'webgl' : 'canvas'}
    />
  );
}

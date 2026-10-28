import { useEffect, useMemo, useRef } from 'react';
import { diffRendererScenes } from '@hall-platform/renderer-core';
import type {
  CameraController,
  RendererEvent,
  RendererScene,
  RendererSeatGeometry,
  RendererSeatPositionUpdate,
  RendererSeatUpdate,
  RendererTargetRef,
  Viewport,
} from '@hall-platform/renderer-core';
import { canvasPixelSize, resizeCanvasBackingStore } from './canvasSize.js';
import { drawSeatLabels } from './seatLabels.js';
import { WebGLHallRenderer } from './WebGLHallRenderer.js';

const noSeatUpdates: readonly RendererSeatUpdate[] = [];
const noSelection: readonly RendererTargetRef[] = [];
const noPreviewPositions: readonly RendererSeatPositionUpdate[] = [];

export type WebGLHallCanvasProps = Readonly<{
  scene: RendererScene<RendererSeatGeometry>;
  viewport: Viewport;
  cameraController?: CameraController;
  seatUpdates?: readonly RendererSeatUpdate[];
  previewPositions?: readonly RendererSeatPositionUpdate[];
  selection?: readonly RendererTargetRef[];
  selectedColor?: string;
  className?: string;
  onEvent?: (event: RendererEvent) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onFrameRendered?: () => void;
  onRendererError?: (error: Error) => void;
  onRendererReady?: () => void;
}>;

export function WebGLHallCanvas({
  scene,
  viewport,
  cameraController,
  seatUpdates = noSeatUpdates,
  previewPositions = noPreviewPositions,
  selection = noSelection,
  selectedColor = '#ed8936',
  className,
  onEvent,
  onContextLost,
  onContextRestored,
  onFrameRendered,
  onRendererError,
  onRendererReady,
}: WebGLHallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLHallRenderer | null>(null);
  const rendererSceneRef = useRef<RendererScene<RendererSeatGeometry> | null>(
    null,
  );
  const rendererReadyRef = useRef(false);
  const labelsById = useMemo(
    () =>
      new Map(
        seatUpdates
          .filter((update) => update.label !== undefined)
          .map((update) => [update.id, update.label ?? '']),
      ),
    [seatUpdates],
  );
  const labelStateRef = useRef({
    scene,
    labelsById,
    previewPositions,
    viewport,
  });
  const drawLabelsRef = useRef<(nextViewport?: Viewport) => void>(
    () => undefined,
  );
  const callbacksRef = useRef({
    onEvent,
    onContextLost,
    onContextRestored,
    onFrameRendered,
    onRendererError,
    onRendererReady,
  });
  useEffect(() => {
    labelStateRef.current = { scene, labelsById, previewPositions, viewport };
    callbacksRef.current = {
      onEvent,
      onContextLost,
      onContextRestored,
      onFrameRendered,
      onRendererError,
      onRendererReady,
    };
    drawLabelsRef.current = (nextViewport) => {
      const canvas = canvasRef.current;
      const labelsCanvas = labelsCanvasRef.current;
      if (!canvas || !labelsCanvas) return;
      const bounds = canvas.getBoundingClientRect();
      const size = canvasPixelSize(
        bounds.width,
        bounds.height,
        window.devicePixelRatio,
      );
      resizeCanvasBackingStore(labelsCanvas, size);
      const context = labelsCanvas.getContext('2d');
      if (!context) return;
      context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const state = labelStateRef.current;
      drawSeatLabels(
        context,
        state.scene,
        state.labelsById,
        nextViewport ?? state.viewport,
        bounds.width,
        bounds.height,
        state.previewPositions,
      );
    };
  }, [
    scene,
    labelsById,
    previewPositions,
    viewport,
    onEvent,
    onContextLost,
    onContextRestored,
    onFrameRendered,
    onRendererError,
    onRendererReady,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLHallRenderer;
    try {
      renderer = new WebGLHallRenderer(canvas, {
        onContextLost: () => callbacksRef.current.onContextLost?.(),
        onContextRestored: () => callbacksRef.current.onContextRestored?.(),
        onFrameRendered: () => callbacksRef.current.onFrameRendered?.(),
        onError: (error) => callbacksRef.current.onRendererError?.(error),
      });
    } catch (error) {
      callbacksRef.current.onRendererError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    rendererRef.current = renderer;
    rendererSceneRef.current = null;
    renderer.setEventHandler((event) => callbacksRef.current.onEvent?.(event));
    const applyCameraFrame = (nextViewport: Viewport) => {
      renderer.applyViewportFrame(nextViewport);
      canvas.dataset.cameraRevision = String(nextViewport.revision ?? 0);
      labelsCanvasRef.current?.setAttribute(
        'data-camera-revision',
        String(nextViewport.revision ?? 0),
      );
      drawLabelsRef.current(nextViewport);
    };
    const detachCamera = cameraController?.attach(applyCameraFrame);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height);
      drawLabelsRef.current(
        cameraController?.getSnapshot() ?? labelStateRef.current.viewport,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      detachCamera?.();
      renderer.dispose();
      rendererReadyRef.current = false;
      rendererSceneRef.current = null;
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [cameraController]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const previous = rendererSceneRef.current;
    if (!previous) {
      if (renderer.setScene(scene)) rendererSceneRef.current = scene;
      return;
    }
    if (previous === scene) return;
    const changes = diffRendererScenes(previous, scene);
    if (changes.replace) {
      if (renderer.setScene(scene)) rendererSceneRef.current = scene;
      return;
    }
    if (renderer.applySceneChanges(changes)) {
      rendererSceneRef.current = scene;
    } else if (renderer.setScene(scene)) {
      rendererSceneRef.current = scene;
    }
  }, [scene]);
  useEffect(
    () => rendererRef.current?.updateSeats(seatUpdates),
    [scene, seatUpdates],
  );
  useEffect(
    () => rendererRef.current?.setPreviewPositions(previewPositions),
    [previewPositions],
  );
  useEffect(() => {
    if (!cameraController) rendererRef.current?.setViewport(viewport);
  }, [cameraController, viewport]);
  useEffect(() => rendererRef.current?.setSelection(selection), [selection]);
  useEffect(
    () => rendererRef.current?.setSelectedColor(selectedColor),
    [selectedColor],
  );
  useEffect(() => {
    if (!rendererRef.current || rendererReadyRef.current) return;
    const frame = requestAnimationFrame(() => {
      rendererReadyRef.current = true;
      callbacksRef.current.onRendererReady?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [scene, seatUpdates, previewPositions, viewport, selection]);
  useEffect(
    () =>
      drawLabelsRef.current(
        cameraController?.getSnapshot() ?? labelStateRef.current.viewport,
      ),
    [scene, labelsById, previewPositions, cameraController],
  );

  return (
    <div
      className={className}
      data-renderer="webgl2"
      data-preview-seats={previewPositions.length}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-renderer="webgl2"
        data-preview-seats={previewPositions.length}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
          zIndex: 0,
        }}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          rendererRef.current?.emitPick({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          });
        }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          rendererRef.current?.emitHover({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          });
        }}
        onPointerLeave={() => rendererRef.current?.emitHover(null)}
      />
      <canvas
        ref={labelsCanvasRef}
        aria-hidden="true"
        data-renderer="seat-labels"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
    </div>
  );
}

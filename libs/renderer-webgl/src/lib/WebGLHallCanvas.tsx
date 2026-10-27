import { useEffect, useMemo, useRef } from 'react';
import type {
  RendererEvent,
  RendererScene,
  RendererSeatGeometry,
  RendererSeatUpdate,
  RendererTargetRef,
  Viewport,
} from '@hall-platform/renderer-core';
import { canvasPixelSize } from './canvasSize.js';
import { drawSeatLabels } from './seatLabels.js';
import { WebGLHallRenderer } from './WebGLHallRenderer.js';

const noSeatUpdates: readonly RendererSeatUpdate[] = [];
const noSelection: readonly RendererTargetRef[] = [];

export type WebGLHallCanvasProps = Readonly<{
  scene: RendererScene<RendererSeatGeometry>;
  viewport: Viewport;
  seatUpdates?: readonly RendererSeatUpdate[];
  selection?: readonly RendererTargetRef[];
  className?: string;
  onEvent?: (event: RendererEvent) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onRendererError?: (error: Error) => void;
}>;

export function WebGLHallCanvas({
  scene,
  viewport,
  seatUpdates = noSeatUpdates,
  selection = noSelection,
  className,
  onEvent,
  onContextLost,
  onContextRestored,
  onRendererError,
}: WebGLHallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLHallRenderer | null>(null);
  const labelsById = useMemo(
    () =>
      new Map(
        seatUpdates
          .filter((update) => update.label !== undefined)
          .map((update) => [update.id, update.label ?? '']),
      ),
    [seatUpdates],
  );
  const labelStateRef = useRef({ scene, labelsById, viewport });
  const drawLabelsRef = useRef<() => void>(() => undefined);
  labelStateRef.current = { scene, labelsById, viewport };
  const callbacksRef = useRef({
    onEvent,
    onContextLost,
    onContextRestored,
    onRendererError,
  });
  callbacksRef.current = {
    onEvent,
    onContextLost,
    onContextRestored,
    onRendererError,
  };

  drawLabelsRef.current = () => {
    const canvas = canvasRef.current;
    const labelsCanvas = labelsCanvasRef.current;
    if (!canvas || !labelsCanvas) return;
    const bounds = canvas.getBoundingClientRect();
    const size = canvasPixelSize(
      bounds.width,
      bounds.height,
      window.devicePixelRatio,
    );
    labelsCanvas.width = size.width;
    labelsCanvas.height = size.height;
    const context = labelsCanvas.getContext('2d');
    if (!context) return;
    context.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const state = labelStateRef.current;
    drawSeatLabels(
      context,
      state.scene,
      state.labelsById,
      state.viewport,
      bounds.width,
      bounds.height,
    );
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLHallRenderer;
    try {
      renderer = new WebGLHallRenderer(canvas, {
        onContextLost: () => callbacksRef.current.onContextLost?.(),
        onContextRestored: () => callbacksRef.current.onContextRestored?.(),
        onError: (error) => callbacksRef.current.onRendererError?.(error),
      });
    } catch (error) {
      callbacksRef.current.onRendererError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    rendererRef.current = renderer;
    renderer.setEventHandler((event) => callbacksRef.current.onEvent?.(event));

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      renderer.resize(bounds.width, bounds.height);
      drawLabelsRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      renderer.dispose();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, []);

  useEffect(() => rendererRef.current?.setScene(scene), [scene]);
  useEffect(() => rendererRef.current?.updateSeats(seatUpdates), [seatUpdates]);
  useEffect(() => rendererRef.current?.setViewport(viewport), [viewport]);
  useEffect(() => rendererRef.current?.setSelection(selection), [selection]);
  useEffect(() => drawLabelsRef.current(), [scene, labelsById, viewport]);

  return (
    <div
      className={className}
      data-renderer="webgl2"
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

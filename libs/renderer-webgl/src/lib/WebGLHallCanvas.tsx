import { useEffect, useRef } from 'react';
import type {
  RendererEvent,
  RendererScene,
  RendererSeatGeometry,
  RendererSeatUpdate,
  RendererTargetRef,
  Viewport,
} from '@hall-platform/renderer-core';
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
  const rendererRef = useRef<WebGLHallRenderer | null>(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLHallRenderer;
    try {
      renderer = new WebGLHallRenderer(canvas, {
        onContextLost: () => callbacksRef.current.onContextLost?.(),
        onContextRestored: () => callbacksRef.current.onContextRestored?.(),
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

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      data-renderer="webgl2"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        touchAction: 'none',
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
  );
}

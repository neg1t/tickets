export type WebGLContextCallbacks = Readonly<{
  onLost(): void;
  onRestored(): void;
}>;

export function observeWebGLContext(
  canvas: HTMLCanvasElement,
  callbacks: WebGLContextCallbacks,
): () => void {
  function handleLost(event: Event): void {
    event.preventDefault();
    callbacks.onLost();
  }
  function handleRestored(): void {
    callbacks.onRestored();
  }

  canvas.addEventListener('webglcontextlost', handleLost);
  canvas.addEventListener('webglcontextrestored', handleRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', handleLost);
    canvas.removeEventListener('webglcontextrestored', handleRestored);
  };
}

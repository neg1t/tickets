export type RendererPreference = 'auto' | 'webgl' | 'canvas';
export type RendererEngine = 'webgl' | 'canvas';

export function createSceneForRenderer<T>(
  engine: RendererEngine,
  createScene: () => T,
): T | null {
  return engine === 'webgl' ? createScene() : null;
}

export function scheduleRendererScenePreparation<T>(
  engine: RendererEngine,
  createScene: () => T,
  onPrepared: (scene: T) => void,
): () => void {
  if (engine !== 'webgl') return () => undefined;

  let cancelled = false;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;
  firstFrame = requestAnimationFrame(() => {
    firstFrame = null;
    if (cancelled) return;
    secondFrame = requestAnimationFrame(() => {
      secondFrame = null;
      if (cancelled) return;
      onPrepared(createScene());
    });
  });

  return () => {
    cancelled = true;
    if (firstFrame !== null) cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) cancelAnimationFrame(secondFrame);
  };
}

/** Auto stays on Canvas until the managed rollout flag is enabled. */
export function selectRendererEngine(
  preference: RendererPreference,
  webglEnabled: boolean,
  webglFailed = false,
): RendererEngine {
  if (preference === 'canvas' || webglFailed) return 'canvas';
  if (preference === 'webgl') return 'webgl';
  return webglEnabled ? 'webgl' : 'canvas';
}

export type RendererPreference = 'auto' | 'webgl' | 'canvas';
export type RendererEngine = 'webgl' | 'canvas';

export function createSceneForRenderer<T>(
  engine: RendererEngine,
  createScene: () => T,
): T | null {
  return engine === 'webgl' ? createScene() : null;
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

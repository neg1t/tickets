import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPerformanceHallSnapshot } from '@hall-platform/fixtures';
import {
  HallViewport,
  type RendererPreference,
} from '@hall-platform/hall-viewer';

type RendererComparisonWindow = Window & {
  __rendererComparisonRoot?: Root;
  __rendererComparisonEngine?: 'canvas' | 'webgl';
};

const snapshot = createPerformanceHallSnapshot(50_000);

function RendererComparisonView({
  renderer,
}: {
  renderer: RendererPreference;
}) {
  return createElement(HallViewport, {
    snapshot,
    hallName: '50k renderer comparison',
    height: 800,
    stageId: 'renderer-comparison-stage',
    renderer,
    webglEnabled: true,
    viewerMode: 'edit',
    activeTool: 'pan',
    onRendererChange: (engine) => {
      (window as RendererComparisonWindow).__rendererComparisonEngine = engine;
    },
  });
}

export function mountRendererComparisonHarness(
  container: HTMLElement,
  renderer: RendererPreference,
): void {
  container.replaceChildren();
  container.style.width = '1280px';
  container.style.height = '820px';
  const root = createRoot(container);
  root.render(createElement(RendererComparisonView, { renderer }));
  (window as RendererComparisonWindow).__rendererComparisonRoot = root;
}

export function unmountRendererComparisonHarness(container: HTMLElement): void {
  const testWindow = window as RendererComparisonWindow;
  testWindow.__rendererComparisonRoot?.unmount();
  delete testWindow.__rendererComparisonRoot;
  delete testWindow.__rendererComparisonEngine;
  container.replaceChildren();
}

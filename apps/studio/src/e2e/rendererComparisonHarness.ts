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
  __rendererComparisonControlSeat?: Readonly<{ id: string; x: number; y: number }>;
};

const snapshot = createPerformanceHallSnapshot(50_000);
function firstControlSeat() {
  const seat = snapshot.seats.find(
    ({ position }) => position.x >= 4_400 && position.y >= 6_000,
  );
  if (!seat) throw new Error('Renderer comparison fixture needs a seat');
  return seat;
}

const controlSeat = firstControlSeat();

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
    seatAppearance: {
      [controlSeat.id]: { fill: '#ff00ff', stroke: '#ff00ff' },
    },
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
  const testWindow = window as RendererComparisonWindow;
  testWindow.__rendererComparisonRoot = root;
  testWindow.__rendererComparisonControlSeat = {
    id: controlSeat.id,
    x: controlSeat.position.x,
    y: controlSeat.position.y,
  };
}

export function unmountRendererComparisonHarness(container: HTMLElement): void {
  const testWindow = window as RendererComparisonWindow;
  testWindow.__rendererComparisonRoot?.unmount();
  delete testWindow.__rendererComparisonRoot;
  delete testWindow.__rendererComparisonEngine;
  delete testWindow.__rendererComparisonControlSeat;
  container.replaceChildren();
}

import { createElement, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { layoutDocumentSchema, layoutSnapshotSchema } from '@hall-platform/domain';
import smallTheater from '@hall-platform/fixtures/small-theater.json' with { type: 'json' };
import type { RendererSeatUpdate } from '@hall-platform/renderer-core';
import type { HallTarget } from '@hall-platform/renderer-konva';
import {
  HallViewport,
  type RendererPreference,
} from '@hall-platform/hall-viewer';

type HallViewportTestWindow = Window & {
  __hallRendererMode?: string;
  __hallRendererTransitions?: Array<{
    engine: 'canvas' | 'webgl';
    seatRenderer: string | null;
  }>;
  __hallRendererError?: string;
  __hallClickTarget?: HallTarget | null;
  __hallSelection?: readonly HallTarget[];
  __hallSeatWorld?: Readonly<{ x: number; y: number }>;
  __hallViewportRoot?: Root;
  __hallMoveDelta?: Readonly<{ x: number; y: number }> | null;
  __hallMoveCommitCount?: number;
  __replaceHallDocument?: () => void;
};

const snapshot = layoutDocumentSchema.parse(smallTheater.document).snapshot;

function HallViewportHarness({
  renderer,
  editorMode,
}: {
  renderer: RendererPreference;
  editorMode: boolean;
}) {
  const [selection, setSelection] = useState<HallTarget[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState(snapshot);
  const seatUpdates = useMemo<readonly RendererSeatUpdate[]>(
    () =>
      currentSnapshot.seats.map((seat) => ({
        id: seat.id,
        status: seat.id === currentSnapshot.seats[1]?.id ? 'sold' : 'available',
        label: seat.label,
      })),
    [currentSnapshot.seats],
  );
  const testWindow = window as HallViewportTestWindow;
  useEffect(() => {
    testWindow.__replaceHallDocument = () => {
      setCurrentSnapshot((previous) =>
        layoutSnapshotSchema.parse({
          ...previous,
          id: `${previous.id}-replacement`,
          seats: previous.seats.slice(1),
        }),
      );
    };
    return () => {
      delete testWindow.__replaceHallDocument;
    };
  }, [testWindow]);

  return createElement(HallViewport, {
    snapshot: currentSnapshot,
    hallName: 'Renderer parity test',
    height: 480,
    stageId: 'renderer-parity-stage',
    viewerMode: editorMode ? 'edit' : 'pick',
    ...(editorMode ? { activeTool: 'select' as const } : {}),
    renderer,
    webglEnabled: false,
    seatUpdates,
    selectedTargets: selection,
    onSelectionChange: (next) => {
      const selected = [...next];
      setSelection(selected);
      testWindow.__hallSelection = selected;
    },
    onCanvasClick: (_point, target) => {
      testWindow.__hallClickTarget = target;
      if (target?.kind === 'seat') setSelection([target]);
    },
    ...(editorMode
      ? {
          onObjectsMove: (
            _targets: readonly HallTarget[],
            delta: Readonly<{ x: number; y: number }>,
          ) => {
            testWindow.__hallMoveDelta = delta;
            testWindow.__hallMoveCommitCount =
              (testWindow.__hallMoveCommitCount ?? 0) + 1;
          },
        }
      : {}),
    onRendererChange: (engine) => {
      testWindow.__hallRendererMode = engine;
      testWindow.__hallRendererTransitions ??= [];
      testWindow.__hallRendererTransitions.push({
        engine,
        seatRenderer:
          document.querySelector<HTMLElement>('.hall-viewer-canvas')?.dataset
            .seatRenderer ?? null,
      });
    },
    onRendererError: (error) => {
      testWindow.__hallRendererError = error.message;
    },
  });
}

export function mountHallViewportHarness(
  container: HTMLElement,
  renderer: RendererPreference,
  editorMode = false,
): void {
  const firstSeat = snapshot.seats[0];
  if (!firstSeat) throw new Error('Small theater fixture has no seats');
  container.replaceChildren();
  container.style.width = '1000px';
  container.style.height = '520px';
  const root = createRoot(container);
  root.render(createElement(HallViewportHarness, { renderer, editorMode }));
  const testWindow = window as HallViewportTestWindow;
  testWindow.__hallMoveDelta = null;
  testWindow.__hallMoveCommitCount = 0;
  testWindow.__hallRendererTransitions = [];
  testWindow.__hallViewportRoot = root;
  testWindow.__hallSeatWorld = firstSeat.position;
}

export function unmountHallViewportHarness(container: HTMLElement): void {
  const testWindow = window as HallViewportTestWindow;
  testWindow.__hallViewportRoot?.unmount();
  delete testWindow.__hallViewportRoot;
  delete testWindow.__hallRendererMode;
  delete testWindow.__hallRendererTransitions;
  delete testWindow.__hallRendererError;
  delete testWindow.__hallClickTarget;
  delete testWindow.__hallSelection;
  delete testWindow.__hallSeatWorld;
  delete testWindow.__hallMoveDelta;
  delete testWindow.__hallMoveCommitCount;
  delete testWindow.__replaceHallDocument;
  container.replaceChildren();
}

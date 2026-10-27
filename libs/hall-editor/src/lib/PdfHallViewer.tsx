import { useEffect, useMemo, useRef, useState } from 'react';
import { renderPdfPage } from '@hall-platform/pdf';
import type { HallViewerProps } from '@hall-platform/renderer-konva';
import {
  HallViewport,
  type RendererPreference,
} from '@hall-platform/hall-viewer';
import type { HallLayoutDraft } from './editorDraft.js';
import { editorText } from './ui/editorI18n.js';

const MAX_CACHED_PAGES = 8;
const MAX_CACHED_CANVAS_BYTES = 64 * 1024 * 1024;
const MAX_CONCURRENT_PAGE_RENDERS = 2;
type RenderedPage = { dataUrl: string; canvas: HTMLCanvasElement };
type PendingPage = {
  dataUrl: string;
  controller: AbortController;
  promise: Promise<RenderedPage>;
};

function canvasBytes(page: RenderedPage): number {
  return page.canvas.width * page.canvas.height * 4;
}

function releaseCanvas(page: RenderedPage): void {
  page.canvas.width = 0;
  page.canvas.height = 0;
}

function pruneInactiveCache(
  cache: Map<string, RenderedPage>,
  required: ReadonlySet<string>,
): void {
  const inactive = [...cache].filter(([key]) => !required.has(key));
  let inactiveBytes = inactive.reduce(
    (total, [, page]) => total + canvasBytes(page),
    0,
  );
  while (
    inactive.length > MAX_CACHED_PAGES ||
    inactiveBytes > MAX_CACHED_CANVAS_BYTES
  ) {
    const oldest = inactive.shift();
    if (!oldest) break;
    const [key, page] = oldest;
    cache.delete(key);
    inactiveBytes -= canvasBytes(page);
    releaseCanvas(page);
  }
}

export type PdfHallViewerProps = Omit<
  HallViewerProps,
  'hallName' | 'snapshot' | 'zoneBounds' | 'backgroundPages'
> & {
  readonly draft: HallLayoutDraft;
  readonly locale?: string;
  readonly onError?: (error: Error) => void;
  readonly renderer?: RendererPreference;
  readonly webglEnabled?: boolean;
};

export function PdfHallViewer(props: PdfHallViewerProps) {
  const {
    draft,
    locale,
    onError,
    renderer = 'auto',
    webglEnabled = false,
    ...viewerProps
  } = props;
  const cache = useRef(new Map<string, RenderedPage>());
  const pending = useRef(new Map<string, PendingPage>());
  const [canvases, setCanvases] = useState<
    Readonly<Record<string, RenderedPage>>
  >({});
  const [renderTick, setRenderTick] = useState(0);
  const [selectedFloorId, setSelectedFloorId] = useState(
    draft.snapshot.floors[0]?.id ?? '',
  );
  const requestedFloorId = viewerProps.focusedFloorId ?? selectedFloorId;
  const activeFloorId = draft.snapshot.floors.some(
    (floor) => floor.id === requestedFloorId,
  )
    ? requestedFloorId
    : (draft.snapshot.floors[0]?.id ?? '');
  const rendererSeatUpdates = useMemo(
    () =>
      draft.snapshot.seats.map((seat) => ({
        id: seat.id,
        status: 'available',
        label: seat.label,
      })),
    [draft.snapshot.seats],
  );
  const pageSizes = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(draft.assets).flatMap(([assetId, asset]) =>
          asset.pages.map((size, index) => [`${assetId}:${index + 1}`, size]),
        ),
      ),
    [draft.assets],
  );
  const requiredPages = useMemo(
    () => [
      ...new Set(
        draft.snapshot.backgrounds
          .filter(
            (background) =>
              background.source.kind === 'pdf' &&
              background.visible &&
              background.floorId === activeFloorId,
          )
          .map(
            (background) =>
              `${background.source.assetId}:${background.source.kind === 'pdf' ? background.source.pageNumber : 1}`,
          ),
      ),
    ],
    [draft.snapshot.backgrounds, activeFloorId],
  );

  useEffect(() => {
    let active = true;
    const required = new Set(requiredPages);
    const maxCanvasPixels = Math.floor(MAX_CACHED_CANVAS_BYTES /
      (4 * Math.max(1, requiredPages.length)));
    for (const [key, task] of pending.current) {
      const asset = draft.assets[key.slice(0, key.lastIndexOf(':'))];
      if (!required.has(key) || !asset || asset.dataUrl !== task.dataUrl) {
        task.controller.abort();
        pending.current.delete(key);
      }
    }
    for (const [key, page] of cache.current) {
      const asset = draft.assets[key.slice(0, key.lastIndexOf(':'))];
      if (!asset || asset.dataUrl !== page.dataUrl ||
        (required.has(key) && page.canvas.width * page.canvas.height > maxCanvasPixels)) {
        cache.current.delete(key);
        releaseCanvas(page);
      }
    }
    pruneInactiveCache(cache.current, required);
    requiredPages.forEach((key) => {
      const split = key.lastIndexOf(':');
      const assetId = key.slice(0, split);
      const pageNumber = Number(key.slice(split + 1));
      const asset = draft.assets[assetId];
      if (!asset) return;
      const cached = cache.current.get(key);
      if (cached?.dataUrl === asset.dataUrl) {
        cache.current.delete(key);
        cache.current.set(key, cached);
        setCanvases((current) =>
          current[key] === cached ? current : { ...current, [key]: cached },
        );
      } else {
        let task = pending.current.get(key);
        if (task?.dataUrl !== asset.dataUrl) {
          if (pending.current.size >= MAX_CONCURRENT_PAGE_RENDERS) return;
          const dataUrl = asset.dataUrl;
          const controller = new AbortController();
          const promise = renderPdfPage(dataUrl, pageNumber, {
            signal: controller.signal,
            maxCanvasPixels,
          }).then(({ canvas }) => {
            const rendered = { dataUrl, canvas };
            if (
              controller.signal.aborted ||
              pending.current.get(key)?.promise !== promise
            ) {
              releaseCanvas(rendered);
              return rendered;
            }
            if (pending.current.get(key)?.promise === promise) {
              cache.current.set(key, rendered);
              pruneInactiveCache(cache.current, required);
            }
            return rendered;
          });
          task = { dataUrl, controller, promise };
          pending.current.set(key, task);
          void promise
            .finally(() => {
              if (pending.current.get(key)?.promise === promise)
                pending.current.delete(key);
              if (!controller.signal.aborted) setRenderTick((tick) => tick + 1);
            })
            .catch(() => undefined);
        }
        void task.promise
          .then((rendered) => {
            if (
              !active ||
              task.controller.signal.aborted ||
              cache.current.get(key) !== rendered
            )
              return;
            setCanvases(Object.fromEntries(cache.current));
          })
          .catch((error: unknown) => {
            if (active && !task.controller.signal.aborted)
              onError?.(
                error instanceof Error ? error : new Error(String(error)),
              );
          });
      }
    });
    setCanvases((current) => {
      const retained = Object.fromEntries(
        Object.entries(current).filter(
          ([key, page]) => cache.current.get(key) === page,
        ),
      );
      return Object.keys(retained).length === Object.keys(current).length
        ? current
        : retained;
    });
    return () => {
      active = false;
    };
  }, [draft.assets, requiredPages, onError, renderTick]);

  useEffect(
    () => () => {
      for (const task of pending.current.values()) task.controller.abort();
      pending.current.clear();
      for (const page of cache.current.values()) releaseCanvas(page);
      cache.current.clear();
    },
    [],
  );

  const backgroundPages = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(pageSizes).map(([key, size]) => {
          const asset = draft.assets[key.slice(0, key.lastIndexOf(':'))];
          const rendered = canvases[key];
          return [
            key,
            {
              ...size,
              ...(requiredPages.includes(key) &&
              rendered &&
              asset &&
              rendered.dataUrl === asset.dataUrl
                ? { canvas: rendered.canvas }
                : {}),
            },
          ];
        }),
      ),
    [pageSizes, canvases, draft.assets, requiredPages],
  );
  const readyCount = requiredPages.filter((key) => {
    const asset = draft.assets[key.slice(0, key.lastIndexOf(':'))];
    return Boolean(asset && canvases[key]?.dataUrl === asset.dataUrl);
  }).length;
  const fitKey = `${draft.snapshot.id}:${draft.snapshot.backgrounds
    .map((background) => {
      const pageNumber =
        background.source.kind === 'pdf' ? background.source.pageNumber : 1;
      const size = pageSizes[`${background.source.assetId}:${pageNumber}`];
      return [
        background.id,
        background.visible,
        background.position.x,
        background.position.y,
        background.scale,
        background.rotationRadians,
        pageNumber,
        size?.width,
        size?.height,
      ].join(',');
    })
    .join(';')}`;

  return (
    <div className="pdf-hall-viewer">
      {requiredPages.length > 0 && (
        <p className="pdf-hall-viewer-status" role="status">
          {editorText(locale, 'Подложка:')}{' '}
          {readyCount === requiredPages.length
            ? editorText(locale, 'отображается')
            : editorText(locale, 'загрузка…')}
        </p>
      )}

      <HallViewport
        {...viewerProps}
        renderer={renderer}
        webglEnabled={webglEnabled}
        seatUpdates={rendererSeatUpdates}
        {...(onError ? { onRendererError: onError } : {})}
        onFloorChange={(floorId) => {
          setSelectedFloorId(floorId);
          viewerProps.onFloorChange?.(floorId);
        }}
        fitKey={fitKey}
        hallName={draft.hallName}
        snapshot={draft.snapshot}
        zoneBounds={draft.zoneBounds}
        backgroundPages={backgroundPages}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { renderPdfPage } from '@hall-platform/pdf';
import {
  HallViewer,
  type HallViewerProps,
} from '@hall-platform/renderer-konva';
import type { HallLayoutDraft } from './editorDraft.js';
import { editorText } from './ui/editorI18n.js';

export type PdfHallViewerProps = Omit<
  HallViewerProps,
  'hallName' | 'snapshot' | 'zoneBounds' | 'backgroundPages'
> & {
  readonly draft: HallLayoutDraft;
  readonly locale?: string;
  readonly onError?: (error: Error) => void;
};

export function PdfHallViewer(props: PdfHallViewerProps) {
  const { draft, locale, onError, ...viewerProps } = props;
  type RenderedPage = { dataUrl: string; canvas: HTMLCanvasElement };
  const cache = useRef(new Map<string, RenderedPage>());
  const pending = useRef(
    new Map<string, { dataUrl: string; promise: Promise<RenderedPage> }>(),
  );
  const [canvases, setCanvases] = useState<
    Readonly<Record<string, RenderedPage>>
  >({});
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
              background.source.kind === 'pdf' && background.visible,
          )
          .map(
            (background) =>
              `${background.source.assetId}:${background.source.kind === 'pdf' ? background.source.pageNumber : 1}`,
          ),
      ),
    ],
    [draft.snapshot.backgrounds],
  );

  useEffect(() => {
    let active = true;
    requiredPages.forEach((key) => {
      const split = key.lastIndexOf(':');
      const assetId = key.slice(0, split);
      const pageNumber = Number(key.slice(split + 1));
      const asset = draft.assets[assetId];
      if (!asset) return;
      const cached = cache.current.get(key);
      if (cached?.dataUrl === asset.dataUrl) {
        setCanvases((current) =>
          current[key] === cached ? current : { ...current, [key]: cached },
        );
      } else {
        let task = pending.current.get(key);
        if (task?.dataUrl !== asset.dataUrl) {
          const dataUrl = asset.dataUrl;
          const promise = renderPdfPage(dataUrl, pageNumber).then(
            ({ canvas }) => {
              const rendered = { dataUrl, canvas };
              if (pending.current.get(key)?.promise === promise)
                cache.current.set(key, rendered);
              return rendered;
            },
          );
          task = { dataUrl, promise };
          pending.current.set(key, task);
          void promise
            .finally(() => {
              if (pending.current.get(key)?.promise === promise)
                pending.current.delete(key);
            })
            .catch(() => undefined);
        }
        void task.promise
          .then((rendered) => {
            if (!active) return;
            setCanvases((current) =>
              current[key] === rendered
                ? current
                : { ...current, [key]: rendered },
            );
          })
          .catch((error: unknown) => {
            if (active)
              onError?.(
                error instanceof Error ? error : new Error(String(error)),
              );
          });
      }
    });
    return () => {
      active = false;
    };
  }, [draft.assets, requiredPages, onError]);

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
              ...(rendered && asset && rendered.dataUrl === asset.dataUrl
                ? { canvas: rendered.canvas }
                : {}),
            },
          ];
        }),
      ),
    [pageSizes, canvases, draft.assets],
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

      <HallViewer
        {...viewerProps}
        fitKey={fitKey}
        hallName={draft.hallName}
        snapshot={draft.snapshot}
        zoneBounds={draft.zoneBounds}
        backgroundPages={backgroundPages}
      />
    </div>
  );
}

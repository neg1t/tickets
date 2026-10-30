import { useCallback, useEffect, useRef, useState } from 'react';
import {
  backgroundIdSchema,
  backgroundSchema,
  type Background,
} from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import { encodePdfDataUrl, inspectPdfBytes } from '@hall-platform/pdf';
import type { EditorCommand } from '../editorCommands.js';
import type { HallLayoutDraft } from '../editorDraft.js';
import { editorText } from '../ui/editorI18n.js';
import {
  assertImportBytes,
  assertImportFile,
  MAX_PDF_IMPORT_PAGES,
} from './importLimits.js';
import { fitBackgroundToPageSize } from '../background/backgroundScale.js';

type PdfImportContext = Readonly<{
  draft: HallLayoutDraft;
  externalValue: HallLayoutDraft;
  activeFloorId: string;
  readonly: boolean;
}>;

type PdfImportOptions = Readonly<{
  locale?: string;
  getContext: () => PdfImportContext;
  commit: (command: EditorCommand, target: HallTarget | null) => boolean;
  onImported: (backgroundId: string) => void;
  report: (error: unknown) => void;
}>;

type PdfImportRequest = Readonly<{ controller: AbortController }>;

/** Owns PDF import requests, cancellation, stale-context checks, and commit. */
export function usePdfImport(options: PdfImportOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<PdfImportRequest | null>(null);
  const optionsRef = useRef(options);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const abort = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);
  const cancel = useCallback(() => {
    abort();
    setImporting(false);
  }, [abort]);

  useEffect(() => () => abort(), [abort]);

  const importPdf = useCallback(
    async (file: File, replace?: Background) => {
      const currentOptions = optionsRef.current;
      const tr = (russian: string) =>
        editorText(currentOptions.locale, russian);
      const startingContext = currentOptions.getContext();
      if (startingContext.readonly || replace?.locked) return;
      try {
        assertImportFile(file, 'pdf');
      } catch (error) {
        currentOptions.report(error);
        return;
      }

      cancel();
      const request: PdfImportRequest = { controller: new AbortController() };
      requestRef.current = request;
      setImporting(true);

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (requestRef.current !== request) return;
        assertImportBytes(bytes.byteLength, 'pdf');
        const pages = await inspectPdfBytes(bytes, {
          signal: request.controller.signal,
          maxPages: MAX_PDF_IMPORT_PAGES,
        });
        if (requestRef.current !== request) return;
        if (pages.length < 1 || pages.length > MAX_PDF_IMPORT_PAGES)
          throw new RangeError(tr('PDF содержит недопустимое число страниц'));
        if (
          pages.some(
            (page) =>
              !Number.isFinite(page.width) ||
              !Number.isFinite(page.height) ||
              page.width <= 0 ||
              page.height <= 0,
          )
        )
          throw new RangeError(tr('PDF содержит страницу неверного размера'));

        const latestOptions = optionsRef.current;
        const currentContext = latestOptions.getContext();
        if (
          currentContext.draft !== startingContext.draft ||
          currentContext.externalValue !== startingContext.externalValue
        )
          throw new Error(
            tr('План изменился во время загрузки PDF. Повторите импорт.'),
          );
        const currentDraft = currentContext.draft;
        const currentBackground = replace
          ? currentDraft.snapshot.backgrounds.find(
              (item) => item.id === replace.id,
            )
          : null;
        if (
          replace &&
          (currentBackground !== replace || currentBackground.locked)
        )
          throw new Error(tr('Подложка недоступна или заблокирована'));
        if (
          !replace &&
          !currentDraft.snapshot.floors.some(
            (floor) => floor.id === startingContext.activeFloorId,
          )
        )
          throw new Error(tr('Этаж для PDF больше не существует'));

        const assetId =
          currentBackground?.source.assetId ?? `asset-${crypto.randomUUID()}`;
        const beforeAsset = currentDraft.assets[assetId] ?? null;
        const asset = {
          kind: 'pdf' as const,
          name: file.name,
          dataUrl: encodePdfDataUrl(bytes),
          pages: [...pages],
        };
        const firstPage = pages[0];
        if (!firstPage) throw new Error(tr('PDF не содержит страниц'));
        const scale = Math.min(1, 20 / firstPage.width);
        const currentAsset = currentBackground
          ? currentDraft.assets[currentBackground.source.assetId]
          : undefined;
        const currentPage =
          currentBackground?.source.kind === 'pdf' && currentAsset?.kind === 'pdf'
            ? currentAsset.pages[currentBackground.source.pageNumber - 1]
            : undefined;
        const replacementFit =
          currentBackground && currentPage
            ? fitBackgroundToPageSize(currentBackground, currentPage, firstPage)
            : undefined;
        const nextBackground = currentBackground
          ? backgroundSchema.parse({
              ...currentBackground,
              ...(replacementFit
                ? { scale: replacementFit.scale, referenceScale: replacementFit.scale, position: replacementFit.position }
                : { referenceScale: currentBackground.scale }),
              source: { kind: 'pdf', assetId, pageNumber: 1 },
            })
          : backgroundSchema.parse({
              id: backgroundIdSchema.parse(
                `background-${crypto.randomUUID()}`,
              ),
              floorId: startingContext.activeFloorId,
              order: currentDraft.snapshot.backgrounds.length,
              position: {
                x: (-firstPage.width * scale) / 2,
                y: (-firstPage.height * scale) / 2,
              },
              scale,
              referenceScale: scale,
              rotationRadians: 0,
              opacity: 0.7,
              visible: true,
              locked: false,
              source: { kind: 'pdf', assetId, pageNumber: 1 },
            });
        const patches: EditorCommand['patches'][number][] = [
          {
            collection: 'assets',
            id: assetId,
            before: beforeAsset,
            after: asset,
          },
          {
            collection: 'backgrounds',
            id: nextBackground.id,
            before: currentBackground ?? null,
            after: nextBackground,
          },
        ];
        if (requestRef.current !== request) return;
        requestRef.current = null;
        if (
          latestOptions.commit(
            {
              kind: currentBackground ? 'update' : 'create',
              patches,
            },
            null,
          )
        )
          latestOptions.onImported(nextBackground.id);
      } catch (error) {
        if (
          requestRef.current === request &&
          !request.controller.signal.aborted
        )
          optionsRef.current.report(error);
      } finally {
        if (requestRef.current === request) {
          requestRef.current = null;
          setImporting(false);
        }
      }
    },
    [cancel],
  );

  return { inputRef, importing, cancel, importPdf };
}

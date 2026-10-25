import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

async function getPdfJs() {
  const pdfjs =
    typeof window === 'undefined'
      ? await import('pdfjs-dist/legacy/build/pdf.mjs')
      : await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc =
    typeof window === 'undefined'
      ? import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
      : workerUrl;
  return pdfjs;
}

const prefix = 'data:application/pdf;base64,';
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
export const MAX_PDF_PAGE_DIMENSION = 100_000;

class PdfRangeError extends RangeError {}
class PdfTypeError extends TypeError {}
class PdfInputError extends Error {}

export type PdfLoadOptions = Readonly<{
  signal?: AbortSignal;
  maxPages?: number;
}>;

function abortError(): Error {
  return new DOMException('PDF operation cancelled', 'AbortError');
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function checkByteLimit(length: number): void {
  if (length > MAX_PDF_BYTES)
    throw new PdfRangeError('PDF must be 20 MB or smaller');
}

function pageLimit(maxPages?: number): number {
  if (maxPages === undefined) return MAX_PDF_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1)
    throw new PdfRangeError('PDF page limit must be a positive integer');
  return Math.min(maxPages, MAX_PDF_PAGES);
}

function checkPageDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_PDF_PAGE_DIMENSION ||
    height > MAX_PDF_PAGE_DIMENSION
  )
    throw new PdfRangeError('Invalid PDF page dimensions');
}

function safePdfError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return abortError();
  if (
    error instanceof PdfRangeError ||
    error instanceof PdfTypeError ||
    error instanceof PdfInputError
  )
    return error;
  return new Error('Unable to read PDF');
}

export type PdfPageSize = Readonly<{ width: number; height: number }>;

export function encodePdfDataUrl(bytes: Uint8Array): string {
  checkByteLimit(bytes.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return prefix + btoa(binary);
}

export function decodePdfDataUrl(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith(prefix))
    throw new PdfTypeError('Expected an embedded PDF data URL');
  const encoded = dataUrl.slice(prefix.length);
  if (encoded.length > Math.ceil(MAX_PDF_BYTES / 3) * 4)
    throw new PdfRangeError('PDF must be 20 MB or smaller');
  try {
    const binary = atob(encoded);
    checkByteLimit(binary.length);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error) {
    if (error instanceof PdfRangeError) throw error;
    throw new PdfTypeError('Invalid embedded PDF data');
  }
}

export async function inspectPdfBytes(
  bytes: Uint8Array,
  options: PdfLoadOptions = {},
): Promise<readonly PdfPageSize[]> {
  checkAborted(options.signal);
  checkByteLimit(bytes.byteLength);
  const maxPages = pageLimit(options.maxPages);
  const pdfjs = await getPdfJs();
  checkAborted(options.signal);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
  });
  const onAbort = () => {
    void loadingTask.destroy();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const document = await loadingTask.promise;
    checkAborted(options.signal);
    if (document.numPages > maxPages)
      throw new PdfRangeError(`PDF must have ${maxPages} pages or fewer`);
    if (document.numPages < 1) throw new PdfInputError('PDF has no pages');
    const pages: PdfPageSize[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      checkAborted(options.signal);
      const page = await document.getPage(pageNumber);
      checkAborted(options.signal);
      const viewport = page.getViewport({ scale: 1 });
      checkPageDimensions(viewport.width, viewport.height);
      pages.push({ width: viewport.width, height: viewport.height });
      page.cleanup();
    }
    return pages;
  } catch (error) {
    throw safePdfError(error, options.signal);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await loadingTask.destroy();
  }
}

export async function renderPdfPage(
  dataUrl: string,
  pageNumber: number,
  options: PdfLoadOptions = {},
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  checkAborted(options.signal);
  const bytes = decodePdfDataUrl(dataUrl);
  const maxPages = pageLimit(options.maxPages);
  const pdfjs = await getPdfJs();
  checkAborted(options.signal);
  const loadingTask = pdfjs.getDocument({ data: bytes, verbosity: 0 });
  let renderTask: { cancel(): void; promise: Promise<unknown> } | undefined;
  const onAbort = () => {
    renderTask?.cancel();
    void loadingTask.destroy();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const document = await loadingTask.promise;
    checkAborted(options.signal);
    if (document.numPages > maxPages)
      throw new PdfRangeError(`PDF must have ${maxPages} pages or fewer`);
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    ) {
      throw new PdfRangeError('PDF page is out of range');
    }
    const page = await document.getPage(pageNumber);
    checkAborted(options.signal);
    const natural = page.getViewport({ scale: 1 });
    checkPageDimensions(natural.width, natural.height);
    const renderScale = Math.min(
      2,
      2048 / Math.max(natural.width, natural.height),
    );
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new PdfInputError('Canvas 2D context is unavailable');
    renderTask = page.render({ canvas, canvasContext: context, viewport });
    await renderTask.promise;
    checkAborted(options.signal);
    page.cleanup();
    return { canvas, width: natural.width, height: natural.height };
  } catch (error) {
    throw safePdfError(error, options.signal);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    await loadingTask.destroy();
  }
}

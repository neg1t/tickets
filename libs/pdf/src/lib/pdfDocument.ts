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

export type PdfPageSize = Readonly<{ width: number; height: number }>;

export function encodePdfDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return prefix + btoa(binary);
}

export function decodePdfDataUrl(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith(prefix))
    throw new TypeError('Expected an embedded PDF data URL');
  const binary = atob(dataUrl.slice(prefix.length));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function inspectPdfBytes(
  bytes: Uint8Array,
): Promise<readonly PdfPageSize[]> {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const document = await loadingTask.promise;
    const pages: PdfPageSize[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

export async function renderPdfPage(
  dataUrl: string,
  pageNumber: number,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({ data: decodePdfDataUrl(dataUrl) });
  try {
    const document = await loadingTask.promise;
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    ) {
      throw new RangeError('PDF page is out of range');
    }
    const page = await document.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const renderScale = Math.min(
      2,
      2048 / Math.max(natural.width, natural.height),
    );
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();
    return { canvas, width: natural.width, height: natural.height };
  } finally {
    await loadingTask.destroy();
  }
}

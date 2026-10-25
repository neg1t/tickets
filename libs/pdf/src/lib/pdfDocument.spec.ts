import { describe, expect, it } from 'vitest';
import {
  decodePdfDataUrl,
  encodePdfDataUrl,
  inspectPdfBytes,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  renderPdfPage,
} from './pdfDocument.js';

function makeTwoPagePdf(pageCount = 2): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${i === 0 ? 200 : 300} ${i === 0 ? 100 : 150}] /Contents ${pageCount + 3} 0 R >>`,
    ),
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('PDF document adapter', () => {
  it('reads page dimensions from an uploaded PDF', async () => {
    expect(await inspectPdfBytes(makeTwoPagePdf())).toEqual([
      { width: 200, height: 100 },
      { width: 300, height: 150 },
    ]);
  });

  it('embeds PDF bytes in JSON and decodes the same bytes', () => {
    const bytes = makeTwoPagePdf();
    expect(decodePdfDataUrl(encodePdfDataUrl(bytes))).toEqual(bytes);
  });

  it('rejects a non-PDF data URL', () => {
    expect(() => decodePdfDataUrl('data:image/png;base64,AA==')).toThrow();
  });

  it('rejects oversized bytes before encoding or parsing', async () => {
    const bytes = new Uint8Array(MAX_PDF_BYTES + 1);
    expect(() => encodePdfDataUrl(bytes)).toThrow(RangeError);
    await expect(inspectPdfBytes(bytes)).rejects.toThrow(RangeError);
  });

  it('rejects oversized embedded data before decoding or rendering', async () => {
    const oversized = `data:application/pdf;base64,${'A'.repeat(
      Math.ceil((MAX_PDF_BYTES + 1) / 3) * 4,
    )}`;
    expect(() => decodePdfDataUrl(oversized)).toThrow(RangeError);
    await expect(renderPdfPage(oversized, 1)).rejects.toThrow(RangeError);
  });

  it('rejects documents above a caller page limit before reading every page', async () => {
    await expect(
      inspectPdfBytes(makeTwoPagePdf(), { maxPages: 1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      inspectPdfBytes(makeTwoPagePdf(), { maxPages: MAX_PDF_PAGES + 1 }),
    ).resolves.toHaveLength(2);
  });

  it('enforces the hard page limit even without caller options', async () => {
    await expect(
      inspectPdfBytes(makeTwoPagePdf(MAX_PDF_PAGES + 1)),
    ).rejects.toThrow(RangeError);
  });

  it('rejects pathological page dimensions', async () => {
    const invalid = new TextDecoder()
      .decode(makeTwoPagePdf())
      .replace('/MediaBox [0 0 200 100]', '/MediaBox [0 0 1000000000 100]');
    await expect(
      inspectPdfBytes(new TextEncoder().encode(invalid)),
    ).rejects.toThrow('Invalid PDF page dimensions');
  });

  it('stops before parsing when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectPdfBytes(makeTwoPagePdf(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      renderPdfPage(encodePdfDataUrl(makeTwoPagePdf()), 1, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops a parse cancelled after it starts', async () => {
    const controller = new AbortController();
    const loading = inspectPdfBytes(makeTwoPagePdf(), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('hides parser diagnostics for invalid PDF bytes', async () => {
    await expect(
      inspectPdfBytes(new TextEncoder().encode('not a pdf')),
    ).rejects.toThrow('Unable to read PDF');
  });
});

import { describe, expect, it } from 'vitest';
import {
  decodePdfDataUrl,
  encodePdfDataUrl,
  inspectPdfBytes,
} from './pdfDocument.js';

function makeTwoPagePdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Contents 5 0 R >>',
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
});

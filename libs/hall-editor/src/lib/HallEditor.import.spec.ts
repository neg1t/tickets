// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createElement } from 'react';
import { backgroundSchema, floorIdSchema } from '@hall-platform/domain';
import { createEmptyDraft } from './editorDraft.js';
import { HallEditor } from './HallEditor.js';
import {
  MAX_PDF_IMPORT_BYTES,
  MAX_PDF_IMPORT_PAGES,
} from './import/importLimits.js';

const pdf = vi.hoisted(() => ({
  MAX_PDF_BYTES: 20 * 1024 * 1024,
  MAX_PDF_PAGES: 200,
  inspectPdfBytes: vi.fn(),
  encodePdfDataUrl: vi.fn(() => 'data:application/pdf;base64,JVBERi0='),
}));

vi.mock('@hall-platform/pdf', () => pdf);
vi.mock('./PdfHallViewer.js', () => ({ PdfHallViewer: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pdfFile(name = 'plan.pdf') {
  const file = new File(['%PDF-1.7'], name, { type: 'application/pdf' });
  const read = vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer);
  Object.defineProperty(file, 'arrayBuffer', { value: read });
  return { file, read };
}

afterEach(() => {
  cleanup();
  pdf.inspectPdfBytes.mockReset();
  pdf.encodePdfDataUrl.mockClear();
});

describe('HallEditor PDF import', () => {
  it('rejects an oversized file without reading it', async () => {
    const onError = vi.fn();
    render(
      createElement(HallEditor, {
        value: createEmptyDraft('Hall'),
        onChange: vi.fn(),
        onError,
      }),
    );
    const { file, read } = pdfFile();
    Object.defineProperty(file, 'size', { value: MAX_PDF_IMPORT_BYTES + 1 });
    fireEvent.change(screen.getByLabelText('Загрузить PDF'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(read).not.toHaveBeenCalled();
    expect(pdf.inspectPdfBytes).not.toHaveBeenCalled();
  });

  it('discards a pending import after the active floor changes', async () => {
    const draft = createEmptyDraft('Hall');
    const firstFloor = draft.snapshot.floors[0];
    if (!firstFloor) throw new Error('Expected the starter floor');
    const secondFloor = {
      ...firstFloor,
      id: floorIdSchema.parse('floor-second'),
      name: 'Second',
    };
    const value = {
      ...draft,
      snapshot: {
        ...draft.snapshot,
        floors: [...draft.snapshot.floors, secondFloor],
      },
    };
    const pending = deferred<readonly { width: number; height: number }[]>();
    pdf.inspectPdfBytes.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    render(createElement(HallEditor, { value, onChange }));
    const { file } = pdfFile();
    fireEvent.change(screen.getByLabelText('Загрузить PDF'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(pdf.inspectPdfBytes).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Активный этаж'), {
      target: { value: secondFloor.id },
    });
    pending.resolve([{ width: 100, height: 100 }]);
    await waitFor(() => expect(screen.queryByText('Чтение PDF…')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('discards a pending import when controlled hall value is replaced', async () => {
    const value = createEmptyDraft('Hall');
    const pending = deferred<readonly { width: number; height: number }[]>();
    pdf.inspectPdfBytes.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const view = render(createElement(HallEditor, { value, onChange }));
    const { file } = pdfFile();
    fireEvent.change(screen.getByLabelText('Загрузить PDF'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(pdf.inspectPdfBytes).toHaveBeenCalledOnce());
    view.rerender(
      createElement(HallEditor, {
        value: { ...value, hallName: 'Other' },
        onChange,
      }),
    );
    pending.resolve([{ width: 100, height: 100 }]);
    await waitFor(() => expect(screen.queryByText('Чтение PDF…')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not commit an invalid inspected page list', async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    pdf.inspectPdfBytes.mockResolvedValue(
      Array.from({ length: MAX_PDF_IMPORT_PAGES + 1 }, () => ({
        width: 100,
        height: 100,
      })),
    );
    render(
      createElement(HallEditor, {
        value: createEmptyDraft('Hall'),
        onChange,
        onError,
      }),
    );
    fireEvent.change(screen.getByLabelText('Загрузить PDF'), {
      target: { files: [pdfFile().file] },
    });
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onChange).not.toHaveBeenCalled();
    expect(pdf.encodePdfDataUrl).not.toHaveBeenCalled();
  });

  it('keeps a deleted background deleted when its replacement finishes later', async () => {
    const base = createEmptyDraft('Hall');
    const firstFloor = base.snapshot.floors[0];
    if (!firstFloor) throw new Error('Expected the starter floor');
    const background = backgroundSchema.parse({
      id: 'background-original',
      floorId: firstFloor.id,
      order: 0,
      position: { x: 0, y: 0 },
      scale: 1,
      rotationRadians: 0,
      opacity: 1,
      visible: true,
      locked: false,
      source: { kind: 'pdf', assetId: 'asset-original', pageNumber: 1 },
    });
    const value = {
      ...base,
      snapshot: { ...base.snapshot, backgrounds: [background] },
      assets: {
        'asset-original': {
          kind: 'pdf' as const,
          name: 'original.pdf',
          dataUrl: 'data:application/pdf;base64,JVBERi0=',
          pages: [{ width: 100, height: 100 }],
        },
      },
    };
    const pending = deferred<readonly { width: number; height: number }[]>();
    pdf.inspectPdfBytes.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    render(createElement(HallEditor, { value, onChange }));
    fireEvent.click(screen.getByRole('button', { name: /original\.pdf/ }));
    fireEvent.change(screen.getByLabelText('Заменить PDF'), {
      target: { files: [pdfFile('new.pdf').file] },
    });
    await waitFor(() => expect(pdf.inspectPdfBytes).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подложку' }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0].snapshot.backgrounds).toHaveLength(0);
    pending.resolve([{ width: 100, height: 100 }]);
    await waitFor(() => expect(screen.queryByText('Чтение PDF…')).toBeNull());
    expect(onChange).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '../editorDraft.js';
import { usePdfImport } from './usePdfImport.js';

const pdf = vi.hoisted(() => ({
  encodePdfDataUrl: vi.fn(() => 'data:application/pdf;base64,JVBERi0='),
  inspectPdfBytes: vi.fn(),
  MAX_PDF_BYTES: 20 * 1024 * 1024,
  MAX_PDF_PAGES: 200,
}));
vi.mock('@hall-platform/pdf', () => pdf);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function makeFile(name: string) {
  const file = new File(['%PDF-1.7'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  });
  return file;
}

function setup(getDraft: () => ReturnType<typeof createEmptyDraft>) {
  const draft = getDraft();
  const floorId = draft.snapshot.floors[0]?.id;
  if (!floorId) throw new Error('Expected a starter floor');
  const commit = vi.fn(() => true);
  const onImported = vi.fn();
  const report = vi.fn();
  const options = {
    getContext: () => ({
      draft: getDraft(),
      externalValue: getDraft(),
      activeFloorId: floorId,
      readonly: false,
    }),
    commit,
    onImported,
    report,
  };
  const hook = renderHook(() => usePdfImport(options));
  return { ...hook, commit, onImported, report };
}

afterEach(() => vi.clearAllMocks());

describe('usePdfImport', () => {
  it('aborts a cancelled parse and ignores its late result', async () => {
    const pending = deferred<readonly { width: number; height: number }[]>();
    pdf.inspectPdfBytes.mockReturnValue(pending.promise);
    const draft = createEmptyDraft('Hall');
    const hook = setup(() => draft);
    let importPromise: Promise<void> | undefined;

    await act(async () => {
      importPromise = hook.result.current.importPdf(makeFile('plan.pdf'));
      await Promise.resolve();
    });
    await waitFor(() => expect(pdf.inspectPdfBytes).toHaveBeenCalledOnce());
    const signal = pdf.inspectPdfBytes.mock.calls[0]?.[1]?.signal as
      | AbortSignal
      | undefined;
    expect(signal?.aborted).toBe(false);

    act(() => hook.result.current.cancel());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve([{ width: 100, height: 100 }]);
      await importPromise;
    });
    expect(hook.commit).not.toHaveBeenCalled();
    expect(hook.result.current.importing).toBe(false);
    hook.unmount();
  });

  it('aborts on disposal and does not commit after unmount', async () => {
    const pending = deferred<readonly { width: number; height: number }[]>();
    pdf.inspectPdfBytes.mockReturnValue(pending.promise);
    const hook = setup(() => createEmptyDraft('Hall'));
    let importPromise: Promise<void> | undefined;

    await act(async () => {
      importPromise = hook.result.current.importPdf(makeFile('plan.pdf'));
      await Promise.resolve();
    });
    await waitFor(() => expect(pdf.inspectPdfBytes).toHaveBeenCalledOnce());
    const signal = pdf.inspectPdfBytes.mock.calls[0]?.[1]?.signal as
      | AbortSignal
      | undefined;

    hook.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve([{ width: 100, height: 100 }]);
      await importPromise;
    });
    expect(hook.commit).not.toHaveBeenCalled();
  });

  it('rejects a stale result if the host replaces the current document', async () => {
    const pending = deferred<readonly { width: number; height: number }[]>();
    pdf.inspectPdfBytes.mockReturnValue(pending.promise);
    let currentDraft = createEmptyDraft('Hall');
    const hook = setup(() => currentDraft);
    let importPromise: Promise<void> | undefined;

    await act(async () => {
      importPromise = hook.result.current.importPdf(makeFile('plan.pdf'));
      await Promise.resolve();
    });
    await waitFor(() => expect(pdf.inspectPdfBytes).toHaveBeenCalledOnce());
    currentDraft = { ...currentDraft, hallName: 'Replacement' };
    await act(async () => {
      pending.resolve([{ width: 100, height: 100 }]);
      await importPromise;
    });

    expect(hook.commit).not.toHaveBeenCalled();
    expect(hook.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('изменился') }),
    );
    hook.unmount();
  });
});

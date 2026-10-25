// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backgroundSchema, floorSchema } from '@hall-platform/domain';
import { createEmptyDraft, type HallLayoutDraft } from './editorDraft.js';
import { PdfHallViewer } from './PdfHallViewer.js';

const mocks = vi.hoisted(() => ({
  renderPdfPage: vi.fn(),
  viewerProps: undefined as
    | { backgroundPages?: Record<string, { canvas?: HTMLCanvasElement }> }
    | undefined,
}));

vi.mock('@hall-platform/pdf', () => ({ renderPdfPage: mocks.renderPdfPage }));
vi.mock('@hall-platform/renderer-konva', () => ({
  HallViewer: (props: typeof mocks.viewerProps) => {
    mocks.viewerProps = props;
    return null;
  },
}));

function makeDraft(source = 'source-a', pageNumber = 1): HallLayoutDraft {
  const draft = createEmptyDraft('Demo');
  return {
    ...draft,
    assets: {
      plan: {
        kind: 'pdf',
        name: 'plan.pdf',
        dataUrl: source,
        pages: Array.from({ length: 10 }, () => ({ width: 100, height: 100 })),
      },
    },
    snapshot: {
      ...draft.snapshot,
      backgrounds: [
        backgroundSchema.parse({
          id: 'background-1',
          floorId: draft.snapshot.floors[0]?.id,
          order: 0,
          position: { x: 0, y: 0 },
          scale: 1,
          rotationRadians: 0,
          opacity: 1,
          visible: true,
          locked: false,
          source: { kind: 'pdf', assetId: 'plan', pageNumber },
        }),
      ],
    },
  };
}

function makeVisibleDraft(pageNumbers: readonly number[]): HallLayoutDraft {
  const draft = makeDraft();
  const template = draft.snapshot.backgrounds[0];
  if (!template) throw new Error('Missing background');
  return {
    ...draft,
    snapshot: {
      ...draft.snapshot,
      backgrounds: pageNumbers.map((pageNumber) =>
        backgroundSchema.parse({
          ...template,
          id: `background-${pageNumber}`,
          source: { kind: 'pdf', assetId: 'plan', pageNumber },
        }),
      ),
    },
  };
}

afterEach(() => {
  mocks.renderPdfPage.mockReset();
  mocks.viewerProps = undefined;
});

describe('PdfHallViewer', () => {
  it('renders at most two PDF pages concurrently', async () => {
    const resolvePage: Array<(value: { canvas: HTMLCanvasElement }) => void> = [];
    mocks.renderPdfPage.mockImplementation(() =>
      new Promise<{ canvas: HTMLCanvasElement }>((resolve) => resolvePage.push(resolve)),
    );
    const view = render(createElement(PdfHallViewer, {
      draft: makeVisibleDraft([1, 2, 3, 4, 5]),
    }));
    expect(mocks.renderPdfPage).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePage[0]?.({ canvas: { width: 100, height: 100 } as HTMLCanvasElement });
    });
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenCalledTimes(3));
    view.unmount();
  });

  it('keeps every simultaneously visible page ready beyond the inactive cache limit', async () => {
    mocks.renderPdfPage.mockImplementation(async () => ({
      canvas: { width: 1024, height: 1024 } as HTMLCanvasElement,
      width: 100,
      height: 100,
    }));
    const view = render(
      createElement(PdfHallViewer, {
        draft: makeVisibleDraft([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      }),
    );
    await waitFor(() =>
      expect(
        (view.getByRole('status') as unknown as { textContent: string | null })
          .textContent,
      ).toContain('отображается'),
    );
    for (let page = 1; page <= 9; page += 1) {
      expect(
        mocks.viewerProps?.backgroundPages?.[`plan:${page}`]?.canvas,
      ).toBeDefined();
    }
    expect(mocks.renderPdfPage).toHaveBeenCalledTimes(9);
    expect(mocks.renderPdfPage.mock.calls[0]?.[2]?.maxCanvasPixels)
      .toBeLessThanOrEqual(Math.floor(64 * 1024 * 1024 / (4 * 9)));
    view.rerender(
      createElement(PdfHallViewer, { draft: makeDraft('source-a', 9) }),
    );
    view.rerender(
      createElement(PdfHallViewer, { draft: makeDraft('source-a', 10) }),
    );
    await waitFor(() =>
      expect(
        mocks.viewerProps?.backgroundPages?.['plan:10']?.canvas,
      ).toBeDefined(),
    );
    view.rerender(createElement(PdfHallViewer, { draft: makeDraft() }));
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenCalledTimes(11));
    view.unmount();
  });

  it('aborts old source work and never shows its late canvas', async () => {
    const requests: Array<{
      signal: AbortSignal | undefined;
      resolve: (value: { canvas: HTMLCanvasElement }) => void;
    }> = [];
    mocks.renderPdfPage.mockImplementation(
      (_url: string, _page: number, options?: { signal?: AbortSignal }) =>
        new Promise<{ canvas: HTMLCanvasElement }>((resolve) =>
          requests.push({ signal: options?.signal, resolve }),
        ),
    );
    const view = render(createElement(PdfHallViewer, { draft: makeDraft() }));
    expect(requests).toHaveLength(1);
    view.rerender(
      createElement(PdfHallViewer, { draft: makeDraft('source-b') }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal?.aborted).toBe(true);
    const staleCanvas = { width: 1, height: 1 } as HTMLCanvasElement;
    await act(async () => requests[0]?.resolve({ canvas: staleCanvas }));
    expect(
      mocks.viewerProps?.backgroundPages?.['plan:1']?.canvas,
    ).toBeUndefined();
    const currentCanvas = { width: 1, height: 1 } as HTMLCanvasElement;
    await act(async () => requests[1]?.resolve({ canvas: currentCanvas }));
    expect(mocks.viewerProps?.backgroundPages?.['plan:1']?.canvas).toBe(
      currentCanvas,
    );
    view.unmount();
  });

  it('releases canvas cache entries after its bounded capacity', async () => {
    mocks.renderPdfPage.mockImplementation(async () => {
      const canvas = { width: 1024, height: 1024 } as HTMLCanvasElement;
      return { canvas, width: 100, height: 100 };
    });
    const view = render(createElement(PdfHallViewer, { draft: makeDraft() }));
    for (let page = 1; page <= 10; page += 1) {
      view.rerender(
        createElement(PdfHallViewer, { draft: makeDraft('source-a', page) }),
      );
      await waitFor(() =>
        expect(
          mocks.viewerProps?.backgroundPages?.[`plan:${page}`]?.canvas,
        ).toBeDefined(),
      );
    }
    view.rerender(createElement(PdfHallViewer, { draft: makeDraft() }));
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenCalledTimes(11));
    view.unmount();
  });

  it('cancels an in-flight page when the focused floor changes', async () => {
    const requests: Array<{
      signal: AbortSignal | undefined;
      resolve: (value: { canvas: HTMLCanvasElement }) => void;
    }> = [];
    mocks.renderPdfPage.mockImplementation(
      (_url: string, _page: number, options?: { signal?: AbortSignal }) =>
        new Promise<{ canvas: HTMLCanvasElement }>((resolve) =>
          requests.push({ signal: options?.signal, resolve }),
        ),
    );
    const draft = makeDraft();
    const secondFloor = floorSchema.parse({
      id: 'floor-2',
      layoutVersionId: draft.snapshot.layoutVersionId,
      name: 'Upper',
    });
    const secondBackground = backgroundSchema.parse({
      ...draft.snapshot.backgrounds[0],
      id: 'background-2',
      floorId: secondFloor.id,
      source: { kind: 'pdf', assetId: 'plan', pageNumber: 2 },
    });
    const twoFloors = {
      ...draft,
      snapshot: {
        ...draft.snapshot,
        floors: [...draft.snapshot.floors, secondFloor],
        backgrounds: [...draft.snapshot.backgrounds, secondBackground],
      },
    };
    const view = render(createElement(PdfHallViewer, { draft: twoFloors }));
    expect(requests).toHaveLength(1);
    view.rerender(
      createElement(PdfHallViewer, {
        draft: twoFloors,
        focusedFloorId: secondFloor.id,
      }),
    );
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(requests).toHaveLength(2);
    await act(async () =>
      requests[0]?.resolve({
        canvas: { width: 1, height: 1 } as HTMLCanvasElement,
      }),
    );
    expect(
      mocks.viewerProps?.backgroundPages?.['plan:1']?.canvas,
    ).toBeUndefined();
    view.unmount();
  });

  it('evicts old canvases when the pixel memory budget is exceeded', async () => {
    mocks.renderPdfPage.mockImplementation(async () => ({
      canvas: { width: 2048, height: 2048 } as HTMLCanvasElement,
      width: 100,
      height: 100,
    }));
    const view = render(createElement(PdfHallViewer, { draft: makeDraft() }));
    for (let page = 1; page <= 6; page += 1) {
      view.rerender(
        createElement(PdfHallViewer, { draft: makeDraft('source-a', page) }),
      );
      await waitFor(() =>
        expect(
          mocks.viewerProps?.backgroundPages?.[`plan:${page}`]?.canvas,
        ).toBeDefined(),
      );
    }
    expect(
      mocks.viewerProps?.backgroundPages?.['plan:1']?.canvas,
    ).toBeUndefined();
    view.rerender(createElement(PdfHallViewer, { draft: makeDraft() }));
    await waitFor(() => expect(mocks.renderPdfPage).toHaveBeenCalledTimes(7));
    view.unmount();
  });

  it('releases cached canvases on unmount', async () => {
    const canvas = { width: 512, height: 512 };
    mocks.renderPdfPage.mockImplementation(async () => {
      return { canvas: canvas as HTMLCanvasElement, width: 100, height: 100 };
    });
    const view = render(createElement(PdfHallViewer, { draft: makeDraft() }));
    await waitFor(() =>
      expect(mocks.viewerProps?.backgroundPages?.['plan:1']?.canvas).toBe(
        canvas,
      ),
    );
    view.unmount();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('aborts pending work on unmount', () => {
    let signal: AbortSignal | undefined;
    mocks.renderPdfPage.mockImplementation(
      (_url: string, _page: number, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => undefined);
      },
    );
    const view = render(createElement(PdfHallViewer, { draft: makeDraft() }));
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

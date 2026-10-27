// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { createEmptyDraft, type HallLayoutDraft } from './editorDraft.js';
import { HallEditor } from './HallEditor.js';

const mocks = vi.hoisted(() => ({
  pdfViewerProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock('./PdfHallViewer.js', () => ({
  PdfHallViewer: (props: Record<string, unknown>) => {
    mocks.pdfViewerProps = props;
    return null;
  },
}));

afterEach(cleanup);

describe('controlled HallEditor', () => {
  it('passes renderer rollout configuration through to the PDF viewer', () => {
    render(
      createElement(HallEditor, {
        value: createEmptyDraft('Hall'),
        onChange: () => undefined,
        rendererPreference: 'webgl',
        webglEnabled: true,
      }),
    );

    expect(mocks.pdfViewerProps).toMatchObject({
      renderer: 'webgl',
      webglEnabled: true,
    });
  });

  it('keeps Undo available when the host returns an equivalent clone', () => {
    function Host() {
      const [value, setValue] = useState<HallLayoutDraft>(() =>
        createEmptyDraft('Hall'),
      );
      return createElement(HallEditor, {
        value,
        onChange: (draft) => setValue(structuredClone(draft)),
      });
    }

    render(createElement(Host));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ряд' }));
    expect(screen.getByRole('button', { name: 'Отменить' })).toHaveProperty(
      'disabled',
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.getByText(/Нет изменений/)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { rowSchema } from '@hall-platform/domain';
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
    expect(screen.getByRole('button', { name: /Отменить/ })).toHaveProperty(
      'disabled',
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: /Отменить/ }));
    expect(screen.getByText(/Нет изменений/)).toBeTruthy();
  });

  it('lets the user publish an empty row after acknowledging the warning', () => {
    const draft = createEmptyDraft('Hall');
    const floorId = draft.snapshot.floors[0]?.id;
    if (!floorId) throw new Error('Missing floor');
    const row = rowSchema.parse({
      id: 'row-empty',
      floorId,
      name: 'Empty row',
      curve: {
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
      },
    });
    const value = {
      ...draft,
      snapshot: { ...draft.snapshot, rows: [row] },
    };
    const onPublish = vi.fn();

    render(
      createElement(HallEditor, {
        value,
        onChange: () => undefined,
        onPublish,
      }),
    );

    const publishButton = screen.getByRole('button', { name: 'Опубликовать' });
    expect(publishButton).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('Публиковать с предупреждениями'));
    expect(publishButton).toHaveProperty('disabled', false);
    fireEvent.click(publishButton);
    expect(onPublish).toHaveBeenCalledWith(value, true);
  });
});

import type { ReactNode } from 'react';
import type { EditorPanel } from './editorPanels.js';
import { editorText } from './editorI18n.js';

export function LayersPanel({
  mobilePanel,
  onClose,
  children,
  locale,
}: {
  readonly mobilePanel: EditorPanel | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly locale?: string | undefined;
}) {
  return (
    <aside
      className="hall-editor-tools"
      aria-label={editorText(locale, 'Структура и настройки')}
      data-mobile-open={mobilePanel === 'layers' || mobilePanel === 'tools'}
      data-mobile-panel={mobilePanel ?? ''}
    >
      <div className="hall-editor-panel-heading">
        <h3>
          {editorText(
            locale,
            mobilePanel === 'tools' ? 'Инструменты' : 'Структура',
          )}
        </h3>
        <button
          type="button"
          className="hall-editor-panel-close"
          aria-label={editorText(locale, 'Закрыть панель')}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </aside>
  );
}

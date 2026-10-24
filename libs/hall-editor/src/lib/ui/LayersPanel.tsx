import type { ReactNode } from 'react';
import type { EditorPanel } from './editorPanels.js';

export function LayersPanel({
  mobilePanel,
  onClose,
  children,
}: {
  readonly mobilePanel: EditorPanel | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <aside
      className="hall-editor-tools"
      aria-label="Структура и настройки"
      data-mobile-open={mobilePanel === 'layers' || mobilePanel === 'tools'}
      data-mobile-panel={mobilePanel ?? ''}
    >
      <div className="hall-editor-panel-heading">
        <h3>{mobilePanel === 'tools' ? 'Инструменты' : 'Структура'}</h3>
        <button
          type="button"
          className="hall-editor-panel-close"
          aria-label="Закрыть панель"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </aside>
  );
}

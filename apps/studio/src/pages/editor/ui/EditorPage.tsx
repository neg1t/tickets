import {
  HallEditor,
  PdfHallViewer,
  type HallLayoutDraft,
} from '@hall-platform/hall-editor';
import { seatIdSchema } from '@hall-platform/domain';
import { withoutEditorBackgrounds } from '@hall-platform/domain';
import type { PublishedVersionMetadata } from '@hall-platform/local-storage';
import { Menu } from '@hall-platform/ui';
import type { RecoveryAutosaveStatus } from '../../dashboard/model/recoveryAutosave.js';
import './editor-page.css';

type EditorPageProps = {
  draft: HallLayoutDraft;
  mode: 'editor' | 'preview' | 'published';
  publishedDraft: HallLayoutDraft | null;
  versions: readonly PublishedVersionMetadata[];
  dirty: boolean;
  notice: string;
  recoveryStatus: RecoveryAutosaveStatus;
  error: string | null;
  saving: boolean;
  changeCount: number;
  onCatalog: () => void;
  onEditor: () => void;
  onPreview: () => void;
  onBuyer: () => void;
  onExport: () => void;
  onExportPackage: () => void;
  onSample: () => void;
  onDuplicate: () => void;
  onRestore: () => void;
  onReset: () => void;
  onDelete: () => void;
  hasSavedHall: boolean;
  onPublished: (id: string) => void;
  onChange: (draft: HallLayoutDraft) => void;
  onSave: (draft: HallLayoutDraft) => void | Promise<void>;
  onPublish: (
    draft: HallLayoutDraft,
    warningsAcknowledged: boolean,
  ) => void | Promise<void>;
};

export function EditorPage(props: EditorPageProps) {
  const published = props.mode === 'published' && props.publishedDraft;
  const title =
    props.mode === 'published'
      ? 'Опубликованная схема'
      : props.mode === 'preview'
        ? 'Просмотр зала'
        : 'Редактор зала';
  return (
    <main className="studio-editor-page" data-change-count={props.changeCount}>
      <header className="studio-editor-topbar">
        <button
          type="button"
          className="studio-editor-back"
          aria-label="К списку залов"
          onClick={props.onCatalog}
        >
          ‹ <span>Все залы</span>
        </button>
        <div className="studio-editor-title">
          <strong>{props.draft.hallName}</strong>
          <span>{title}</span>
        </div>
        <span className="studio-editor-save-status" role="status">
          {props.dirty
            ? props.recoveryStatus.state === 'saving'
              ? 'Сохраняем копию…'
              : props.recoveryStatus.state === 'saved'
                ? 'Копия черновика сохранена'
                : props.recoveryStatus.state === 'error'
                  ? 'Не удалось сохранить копию · экспортируйте JSON'
                  : 'Есть несохранённые изменения'
            : props.notice}
        </span>
        <div className="studio-editor-top-actions">
          <nav className="studio-editor-mode-actions" aria-label="Режимы схемы">
            <button
              type="button"
              onClick={props.onEditor}
              aria-current={props.mode === 'editor' ? 'page' : undefined}
            >
              Редактор
            </button>
            <button
              type="button"
              onClick={props.onPreview}
              aria-current={props.mode === 'preview' ? 'page' : undefined}
            >
              Просмотр
            </button>
            <button
              type="button"
              onClick={props.onBuyer}
              disabled={props.versions.length === 0}
            >
              Покупательская схема
            </button>
          </nav>
          <div
            className="studio-editor-export-actions"
            role="group"
            aria-label="Экспорт схемы"
          >
            <button type="button" onClick={props.onExport}>
              Экспорт JSON
            </button>
            {props.hasSavedHall && (
              <button
                type="button"
                onClick={props.onExportPackage}
                disabled={props.dirty}
              >
                Экспорт пакета
              </button>
            )}
          </div>
          <Menu label="Демо и обслуживание">
            <button type="button" role="menuitem" onClick={props.onSample}>
              Открыть тестовый зал
            </button>
            <button type="button" role="menuitem" onClick={props.onDuplicate}>
              Создать копию
            </button>
            <button type="button" role="menuitem" onClick={props.onRestore}>
              Восстановить примеры
            </button>
            <button type="button" role="menuitem" onClick={props.onReset}>
              Сбросить демо-данные
            </button>
            {props.hasSavedHall && (
              <button type="button" role="menuitem" onClick={props.onDelete}>
                Удалить зал
              </button>
            )}
          </Menu>
        </div>
      </header>
      {props.error && (
        <div role="alert" className="studio-editor-error">
          {props.error}
        </div>
      )}
      {props.versions.length > 0 && (
        <nav className="studio-version-bar" aria-label="Опубликованные версии">
          {props.versions.map((version) => (
            <button
              type="button"
              key={version.versionId}
              onClick={() => props.onPublished(version.versionId)}
            >
              Версия {version.versionNumber}
            </button>
          ))}
        </nav>
      )}
      <section className="studio-editor-content" aria-label={title}>
        {props.mode === 'editor' ? (
          <HallEditor
            value={props.draft}
            publishedSeatIds={props.versions.flatMap((version) =>
              version.seatIds.map((id) => seatIdSchema.parse(id)),
            )}
            onChange={props.onChange}
            saving={props.saving}
            onSave={props.onSave}
            onPublish={props.onPublish}
          />
        ) : (
          <div className="studio-preview-content">
            {published && (
              <p>Опубликовано: {published.snapshot.seats.length} мест</p>
            )}
            <PdfHallViewer
              draft={withoutEditorBackgrounds(published || props.draft)}
            />
          </div>
        )}
      </section>
    </main>
  );
}

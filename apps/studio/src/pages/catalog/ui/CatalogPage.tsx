import { useMemo, useState } from 'react';
import { PERFORMANCE_HALL_ID } from '@hall-platform/fixtures';
import type { HallSummary, RecoveryDraft } from '@hall-platform/local-storage';
import type { RecoveryAutosaveStatus } from '../../dashboard/model/recoveryAutosave.js';
import { Button } from '@hall-platform/ui';
import './catalog.css';

export type CatalogPageProps = {
  catalog: readonly HallSummary[];
  currentHallName: string;
  dirty: boolean;
  ready: boolean;
  saving: boolean;
  notice: string;
  recoveryStatus: RecoveryAutosaveStatus;
  recoveryDrafts: readonly RecoveryDraft[];
  error: string | null;
  hasSavedHall: boolean;
  hasPublishedVersion: boolean;
  creatingPerformanceHall: boolean;
  onCreate: () => void;
  onCreatePerformanceHall: () => void;
  onOpen: (id: string) => void;
  onEditor: () => void;
  onPreview: () => void;
  onBuyer: () => void;
  onEvents: () => void;
  onSample: () => void;
  onDuplicate: () => void;
  onRestore: () => void;
  onReset: () => void;
  onDelete: () => void;
  onExport: () => void;
  onExportPackage: () => void;
  onImport: (file: File) => void;
  onImportPackage: (file: File) => void;
  onRetry: () => void;
  onRestoreRecovery: (item: RecoveryDraft) => void;
  onExportRecovery: (item: RecoveryDraft) => void;
  onDiscardRecovery: (item: RecoveryDraft) => void;
};

function HallThumbnail({ hall }: { hall: HallSummary }) {
  const zoneCount = Math.max(1, Math.min(hall.zones, 4));
  const dotsPerZone = Math.max(
    1,
    Math.min(Math.ceil(hall.seats / zoneCount), 12),
  );
  return (
    <div className="catalog-thumbnail" aria-hidden="true">
      <div className="catalog-thumbnail-stage">СЦЕНА / ОРИЕНТИР</div>
      <div className="catalog-thumbnail-zones">
        {Array.from({ length: zoneCount }, (_, zone) => (
          <div className="catalog-thumbnail-zone" key={zone}>
            {Array.from({ length: dotsPerZone }, (_, seat) => (
              <i key={seat} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function changedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Дата изменения неизвестна';
  return `Изменён ${new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(date)}`;
}

export function CatalogPage(props: CatalogPageProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [serviceOpen, setServiceOpen] = useState(false);
  const visibleHalls = useMemo(() => {
    const result = props.catalog.filter((hall) =>
      hall.name
        .toLocaleLowerCase('ru-RU')
        .includes(query.trim().toLocaleLowerCase('ru-RU')),
    );
    return [...result].sort((left, right) =>
      sort === 'name'
        ? left.name.localeCompare(right.name, 'ru-RU')
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [props.catalog, query, sort]);
  const hasPerformanceHall = props.catalog.some(
    (hall) => hall.id === PERFORMANCE_HALL_ID,
  );

  return (
    <div className="studio-catalog-page">
      <header className="studio-main-header">
        <div className="studio-brand">
          <span className="studio-brand-mark">H</span>
          <strong>Hall Studio</strong>
        </div>
        <nav aria-label="Основная навигация" className="studio-top-nav">
          <span aria-current="page">Залы</span>
          <button type="button" onClick={props.onEvents}>
            Демо-мероприятия
          </button>
        </nav>
        <button
          type="button"
          className="studio-button studio-button-primary studio-mobile-create"
          onClick={props.onCreate}
          disabled={!props.ready || props.saving}
        >
          ＋ Создать
        </button>
      </header>

      <main className="studio-catalog-content">
        <div className="studio-catalog-heading">
          <div>
            <span className="studio-eyebrow">Рабочее пространство</span>
            <h1>Мои залы</h1>
            <p>Схемы залов и опубликованные версии в одном месте</p>
          </div>
          <Button
            tone="primary"
            className="studio-button studio-button-primary studio-desktop-create"
            onClick={props.onCreate}
            disabled={!props.ready || props.saving}
          >
            ＋ Новый зал
          </Button>
        </div>

        <p className="studio-catalog-status" role="status">
          {props.dirty
            ? `Есть несохранённые изменения: ${props.currentHallName}. ${props.recoveryStatus.state === 'saving' ? 'Сохранение копии…' : props.recoveryStatus.state === 'saved' ? 'Копия сохранена.' : props.recoveryStatus.state === 'error' ? 'Ошибка сохранения копии.' : ''}`
            : props.notice}
        </p>
        {props.error && (
          <div role="alert" className="studio-alert">
            <strong>Не удалось выполнить действие.</strong> {props.error}
            {!props.ready && (
              <button
                type="button"
                className="studio-button"
                onClick={props.onRetry}
              >
                Повторить загрузку
              </button>
            )}
          </div>
        )}
        {props.recoveryDrafts.length > 0 && (
          <section
            className="studio-recovery"
            aria-label="Черновики восстановления"
          >
            <strong>Несохранённые черновики</strong>
            {props.recoveryDrafts.map((item) => {
              const savedHall = props.catalog.find(
                (hall) => hall.id === item.hallId,
              );
              const conflict = Boolean(
                savedHall && savedHall.revision !== item.baseRevision,
              );
              return (
                <div className="studio-recovery-item" key={item.hallId}>
                  <span>
                    {item.draft.hallName} ·{' '}
                    {conflict
                      ? 'конфликт версий, экспортируйте копию'
                      : 'можно восстановить'}
                  </span>
                  {!conflict && (
                    <button
                      type="button"
                      className="studio-button"
                      onClick={() => props.onRestoreRecovery(item)}
                    >
                      Восстановить черновик
                    </button>
                  )}
                  <button
                    type="button"
                    className="studio-button"
                    onClick={() => props.onExportRecovery(item)}
                  >
                    Экспортировать копию
                  </button>
                  <button
                    type="button"
                    className="studio-button"
                    onClick={() => props.onDiscardRecovery(item)}
                  >
                    Удалить копию
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <div className="studio-catalog-filters">
          <label className="studio-search-field">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Найти зал"
              placeholder="Найти зал по названию"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <label className="studio-sort-field">
            <span className="sr-only">Сортировка залов</span>
            <select
              aria-label="Сортировка залов"
              value={sort}
              onChange={(event) =>
                setSort(event.currentTarget.value as 'updated' | 'name')
              }
            >
              <option value="updated">Недавно изменённые</option>
              <option value="name">По названию</option>
            </select>
          </label>
        </div>

        {!props.ready ? (
          <p role="status">
            {props.error
              ? 'Загрузка остановлена. Повторите попытку.'
              : 'Загрузка локальных залов…'}
          </p>
        ) : visibleHalls.length === 0 ? (
          <div className="studio-catalog-empty">
            <span aria-hidden="true">▦</span>
            <h2>{query ? 'Ничего не найдено' : 'Залов пока нет'}</h2>
            <p>
              {query
                ? 'Попробуйте другое название.'
                : 'Создайте схему с нуля или импортируйте готовый JSON.'}
            </p>
            <button
              type="button"
              className="studio-button studio-button-primary"
              onClick={query ? () => setQuery('') : props.onCreate}
            >
              {query ? 'Очистить поиск' : 'Создать зал'}
            </button>
          </div>
        ) : (
          <div className="hall-catalog" aria-label="Каталог залов">
            {visibleHalls.map((hall) => (
              <article className="hall-card" key={hall.id}>
                <HallThumbnail hall={hall} />
                <div className="hall-card-content">
                  <h2>{hall.name}</h2>
                  <p>
                    {hall.zones} зон · {hall.seats} мест ·{' '}
                    {changedAt(hall.updatedAt)}
                  </p>
                  <div className="hall-card-bottom">
                    <span
                      className={
                        hall.publishedVersionNumber > 0
                          ? 'studio-badge studio-badge-published'
                          : 'studio-badge studio-badge-draft'
                      }
                    >
                      {hall.publishedVersionNumber > 0
                        ? `Опубликована версия ${hall.publishedVersionNumber}`
                        : 'Черновик'}
                    </span>
                    <button
                      type="button"
                      className="studio-button studio-button-small"
                      onClick={() => props.onOpen(hall.id)}
                      disabled={props.saving}
                    >
                      Открыть черновик
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <section className="studio-service" aria-label="Демо и обслуживание">
          <div>
            <h2>Демо и обслуживание</h2>
            <p>Импорт, экспорт, просмотр и управление локальными данными.</p>
          </div>
          <Button
            className="studio-button"
            aria-expanded={serviceOpen}
            onClick={() => setServiceOpen((value) => !value)}
          >
            Демо и обслуживание
          </Button>
          {serviceOpen && (
            <div className="studio-service-actions">
              <button
                type="button"
                className="studio-button"
                onClick={props.onEditor}
              >
                Редактор
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onPreview}
              >
                Просмотр
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onBuyer}
                disabled={!props.hasPublishedVersion}
              >
                Покупательская схема
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onSample}
              >
                Открыть тестовый зал
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onCreatePerformanceHall}
                disabled={
                  !props.ready || props.saving || props.creatingPerformanceHall
                }
                title="Тестовый зал сохраняется в данных этого браузера"
              >
                {props.creatingPerformanceHall
                  ? 'Создаём тестовый зал · 50 000 мест…'
                  : hasPerformanceHall
                    ? 'Открыть тестовый зал · 50 000 мест'
                    : 'Создать тестовый зал · 50 000 мест'}
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onExport}
              >
                Экспорт JSON
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onExportPackage}
                disabled={!props.hasSavedHall || props.dirty}
              >
                Экспорт пакета
              </button>
              <label className="studio-button studio-import-label">
                Открыть JSON
                <input
                  aria-label="Открыть JSON"
                  type="file"
                  accept="application/json,.json"
                  disabled={!props.ready || props.saving}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) props.onImport(file);
                  }}
                />
              </label>
              <label className="studio-button studio-import-label">
                Открыть пакет
                <input
                  aria-label="Открыть пакет"
                  type="file"
                  accept="application/json,.json"
                  disabled={!props.ready || props.saving}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) props.onImportPackage(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="studio-button"
                onClick={props.onDuplicate}
              >
                Создать копию
              </button>
              <button
                type="button"
                className="studio-button"
                onClick={props.onRestore}
              >
                Восстановить примеры
              </button>
              <button
                type="button"
                className="studio-button studio-button-danger"
                onClick={props.onReset}
              >
                Сбросить демо-данные
              </button>
              {props.hasSavedHall && (
                <button
                  type="button"
                  className="studio-button studio-button-danger"
                  onClick={props.onDelete}
                >
                  Удалить зал
                </button>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

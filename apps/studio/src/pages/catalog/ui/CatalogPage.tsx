import { useMemo, useState } from 'react';
import type { HallSummary } from '@hall-platform/local-storage';
import { Button } from '@hall-platform/ui';
import './catalog.css';

export type CatalogPageProps = {
  catalog: readonly HallSummary[];
  currentHallName: string;
  dirty: boolean;
  ready: boolean;
  saving: boolean;
  notice: string;
  error: string | null;
  hasSavedHall: boolean;
  hasPublishedVersion: boolean;
  onCreate: () => void;
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
  onImport: (file: File) => void;
};

function HallThumbnail({ hall }: { hall: HallSummary }) {
  const zoneCount = Math.max(1, Math.min(hall.zones, 4));
  const dotsPerZone = Math.max(1, Math.min(Math.ceil(hall.seats / zoneCount), 12));
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
      hall.name.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')),
    );
    return [...result].sort((left, right) =>
      sort === 'name'
        ? left.name.localeCompare(right.name, 'ru-RU')
        : right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [props.catalog, query, sort]);

  return (
    <div className="studio-catalog-page">
      <header className="studio-main-header">
        <div className="studio-brand"><span className="studio-brand-mark">H</span><strong>Hall Studio</strong></div>
        <nav aria-label="Основная навигация" className="studio-top-nav">
          <span aria-current="page">Залы</span>
          <button type="button" onClick={props.onEvents}>Демо-мероприятия</button>
        </nav>
        <button type="button" className="studio-button studio-button-primary studio-mobile-create" onClick={props.onCreate} disabled={!props.ready || props.saving}>＋ Создать</button>
      </header>

      <main className="studio-catalog-content">
        <div className="studio-catalog-heading">
          <div><span className="studio-eyebrow">Рабочее пространство</span><h1>Мои залы</h1><p>Схемы залов и опубликованные версии в одном месте</p></div>
          <Button tone="primary" className="studio-button studio-button-primary studio-desktop-create" onClick={props.onCreate} disabled={!props.ready || props.saving}>＋ Новый зал</Button>
        </div>

        <p className="studio-catalog-status" role="status">{props.dirty ? `Есть несохранённые изменения: ${props.currentHallName}` : props.notice}</p>
        {props.error && <div role="alert" className="studio-alert"><strong>Не удалось выполнить действие.</strong> {props.error}</div>}

        <div className="studio-catalog-filters">
          <label className="studio-search-field"><span aria-hidden="true">⌕</span><input type="search" aria-label="Найти зал" placeholder="Найти зал по названию" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label>
          <label className="studio-sort-field"><span className="sr-only">Сортировка залов</span><select aria-label="Сортировка залов" value={sort} onChange={(event) => setSort(event.currentTarget.value as 'updated' | 'name')}><option value="updated">Недавно изменённые</option><option value="name">По названию</option></select></label>
        </div>

        {!props.ready ? <p role="status">Загрузка локальных залов…</p> : visibleHalls.length === 0 ? (
          <div className="studio-catalog-empty"><span aria-hidden="true">▦</span><h2>{query ? 'Ничего не найдено' : 'Залов пока нет'}</h2><p>{query ? 'Попробуйте другое название.' : 'Создайте схему с нуля или импортируйте готовый JSON.'}</p><button type="button" className="studio-button studio-button-primary" onClick={query ? () => setQuery('') : props.onCreate}>{query ? 'Очистить поиск' : 'Создать зал'}</button></div>
        ) : (
          <div className="hall-catalog" aria-label="Каталог залов">
            {visibleHalls.map((hall) => (
              <article className="hall-card" key={hall.id}>
                <HallThumbnail hall={hall} />
                <div className="hall-card-content"><h2>{hall.name}</h2><p>{hall.zones} зон · {hall.seats} мест · {changedAt(hall.updatedAt)}</p><div className="hall-card-bottom"><span className={hall.publishedVersionNumber > 0 ? 'studio-badge studio-badge-published' : 'studio-badge studio-badge-draft'}>{hall.publishedVersionNumber > 0 ? `Опубликована версия ${hall.publishedVersionNumber}` : 'Черновик'}</span><button type="button" className="studio-button studio-button-small" onClick={() => props.onOpen(hall.id)} disabled={props.saving}>Открыть черновик</button></div></div>
              </article>
            ))}
          </div>
        )}

        <section className="studio-service" aria-label="Демо и обслуживание">
          <div><h2>Демо и обслуживание</h2><p>Импорт, экспорт, просмотр и управление локальными данными.</p></div>
          <Button className="studio-button" aria-expanded={serviceOpen} onClick={() => setServiceOpen((value) => !value)}>Демо и обслуживание</Button>
          {serviceOpen && <div className="studio-service-actions">
            <button type="button" className="studio-button" onClick={props.onEditor}>Редактор</button>
            <button type="button" className="studio-button" onClick={props.onPreview}>Просмотр</button>
            <button type="button" className="studio-button" onClick={props.onBuyer} disabled={!props.hasPublishedVersion}>Покупательская схема</button>
            <button type="button" className="studio-button" onClick={props.onSample}>Открыть тестовый зал</button>
            <button type="button" className="studio-button" onClick={props.onExport}>Экспорт JSON</button>
            <label className="studio-button studio-import-label">Открыть JSON<input aria-label="Открыть JSON" type="file" accept="application/json,.json" disabled={!props.ready || props.saving} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) props.onImport(file); }} /></label>
            <button type="button" className="studio-button" onClick={props.onDuplicate}>Создать копию</button>
            <button type="button" className="studio-button" onClick={props.onRestore}>Восстановить примеры</button>
            <button type="button" className="studio-button studio-button-danger" onClick={props.onReset}>Сбросить демо-данные</button>
            {props.hasSavedHall && <button type="button" className="studio-button studio-button-danger" onClick={props.onDelete}>Удалить зал</button>}
          </div>}
        </section>
      </main>
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { LayoutSnapshot } from '@hall-platform/domain';
import type { HallTarget } from '@hall-platform/renderer-core';
import { hallTargetKey } from './editorStructureModel.js';
import { editorText } from './editorI18n.js';

type StructureItem = Readonly<{
  target: HallTarget;
  label: string;
  searchText: string;
}>;

const maximumItems = 80;

function VisibilityIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="M2 10s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      {hidden && (
        <path d="m3 3 14 14" stroke="currentColor" strokeWidth="1.7" />
      )}
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <rect
        x="3"
        y="8"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={locked ? 'M6 8V6a4 4 0 0 1 8 0v2' : 'M6 8V6a4 4 0 0 1 7.4-2'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function targetLabel(locale: string | undefined, kind: HallTarget['kind']) {
  switch (kind) {
    case 'zone':
      return editorText(locale, 'Зона');
    case 'row':
      return editorText(locale, 'Ряд');
    case 'table':
      return editorText(locale, 'Стол');
    case 'seat':
      return editorText(locale, 'Место');
    case 'decoration':
      return editorText(locale, 'Объект');
  }
}

export function EditorStructure({
  snapshot,
  floorId,
  selection,
  directHiddenKeys,
  effectiveHiddenKeys,
  directLockedKeys,
  effectiveLockedKeys,
  locale,
  onSelect,
  onToggleHidden,
  onToggleLocked,
}: {
  readonly snapshot: LayoutSnapshot;
  readonly floorId: string;
  readonly selection: readonly HallTarget[];
  readonly directHiddenKeys: ReadonlySet<string>;
  readonly effectiveHiddenKeys: ReadonlySet<string>;
  readonly directLockedKeys: ReadonlySet<string>;
  readonly effectiveLockedKeys: ReadonlySet<string>;
  readonly locale?: string | undefined;
  readonly onSelect: (target: HallTarget) => void;
  readonly onToggleHidden: (target: HallTarget) => void;
  readonly onToggleLocked: (target: HallTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const result = useMemo(() => {
    const visibleItems: StructureItem[] = [];
    let matchCount = 0;
    const add = (item: StructureItem) => {
      if (
        normalizedQuery &&
        !item.searchText.toLocaleLowerCase().includes(normalizedQuery)
      )
        return;
      matchCount += 1;
      if (visibleItems.length < maximumItems) visibleItems.push(item);
    };
    const zones = snapshot.zones
      .filter((zone) => zone.floorId === floorId)
      .map((zone): StructureItem => ({
        target: { kind: 'zone', id: zone.id } as const,
        label: zone.name,
        searchText: `zone ${zone.name}`,
      }));
    const rows = snapshot.rows
      .filter((row) => row.floorId === floorId)
      .map((row): StructureItem => ({
        target: { kind: 'row', id: row.id } as const,
        label: row.name,
        searchText: `row ${row.name}`,
      }));
    const tables = snapshot.tables
      .filter((table) => table.floorId === floorId)
      .map((table): StructureItem => ({
        target: { kind: 'table', id: table.id } as const,
        label: table.label,
        searchText: `table ${table.label}`,
      }));
    const decorations = snapshot.decorations
      .filter((item) => item.floorId === floorId)
      .map((item): StructureItem => ({
        target: { kind: 'decoration', id: item.id } as const,
        label: item.kind === 'label' ? item.text : (item.label ?? item.kind),
        searchText: `${item.kind} ${item.kind === 'label' ? item.text : (item.label ?? '')}`,
      }));
    for (const item of [...zones, ...rows, ...tables, ...decorations])
      add(item);
    if (normalizedQuery) {
      for (const seat of snapshot.seats) {
        if (seat.floorId !== floorId) continue;
        const searchText = `seat ${seat.label} ${seat.id}`;
        if (!searchText.toLocaleLowerCase().includes(normalizedQuery)) continue;
        add({
          target: { kind: 'seat', id: seat.id },
          label: seat.label,
          searchText,
        });
      }
    }
    return { items: visibleItems, matchCount };
  }, [snapshot, floorId, normalizedQuery]);

  return (
    <section
      className="hall-editor-structure-panel"
      aria-label={editorText(locale, 'Дерево объектов')}
    >
      <label className="hall-editor-structure-search">
        <span>{editorText(locale, 'Найти объект')}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={editorText(locale, 'Сектор, ряд, место')}
          aria-label={editorText(locale, 'Найти объект')}
        />
      </label>
      <div
        role="tree"
        aria-label={editorText(locale, 'Дерево объектов')}
        className="hall-editor-structure-tree"
      >
        {result.items.map((item) => {
          const key = hallTargetKey(item.target);
          const selected = selection.some(
            (target) => hallTargetKey(target) === key,
          );
          const hidden = effectiveHiddenKeys.has(key);
          const hiddenInherited = hidden && !directHiddenKeys.has(key);
          const locked = effectiveLockedKeys.has(key);
          const lockedInherited = locked && !directLockedKeys.has(key);
          const itemName = `${targetLabel(locale, item.target.kind)} ${item.label}`;
          return (
            <div
              role="treeitem"
              aria-selected={selected}
              aria-level={1}
              key={key}
              className="hall-editor-structure-item"
              data-hidden={hidden}
              data-locked={locked}
            >
              <button
                type="button"
                className="hall-editor-structure-select"
                aria-label={`${editorText(locale, 'Выбрать')} ${itemName}`}
                aria-pressed={selected}
                onClick={() => onSelect(item.target)}
              >
                <span aria-hidden="true" className="hall-editor-structure-kind">
                  {targetLabel(locale, item.target.kind)}
                </span>
                <span className="hall-editor-structure-name">{item.label}</span>
              </button>
              <button
                type="button"
                className="hall-editor-structure-state"
                aria-label={`${editorText(locale, hidden ? 'Показать' : 'Скрыть')} ${itemName}`}
                aria-pressed={hidden}
                title={
                  hiddenInherited
                    ? editorText(locale, 'Скрыто родительским объектом')
                    : undefined
                }
                disabled={hiddenInherited}
                onClick={() => onToggleHidden(item.target)}
              >
                <VisibilityIcon hidden={hidden} />
              </button>
              <button
                type="button"
                className="hall-editor-structure-state"
                aria-label={`${editorText(locale, locked ? 'Разблокировать' : 'Заблокировать')} ${itemName}`}
                aria-pressed={locked}
                title={
                  lockedInherited
                    ? editorText(locale, 'Заблокировано родительским объектом')
                    : undefined
                }
                disabled={lockedInherited}
                onClick={() => onToggleLocked(item.target)}
              >
                <LockIcon locked={locked} />
              </button>
            </div>
          );
        })}
        {result.matchCount === 0 && (
          <p className="hall-editor-structure-empty">
            {editorText(
              locale,
              normalizedQuery ? 'Объекты не найдены' : 'Нет объектов',
            )}
          </p>
        )}
      </div>
      {result.matchCount > maximumItems && (
        <p className="hall-editor-structure-count" role="status">
          {editorText(locale, 'Показано')} {maximumItems}{' '}
          {editorText(locale, 'из')} {result.matchCount}
        </p>
      )}
    </section>
  );
}

import type { ReactNode } from 'react';
import type { EditorTool } from '../editorOperations.js';
import { editorText } from './editorI18n.js';

export const editorTools: readonly {
  id: EditorTool;
  label: string;
  group: string;
  shortcut?: string;
}[] = [
  { id: 'select', label: 'Выбор', group: 'Навигация', shortcut: 'V' },
  { id: 'pan', label: 'Рука', group: 'Навигация', shortcut: 'H' },
  { id: 'zone', label: 'Зона', group: 'Планировка' },
  { id: 'zone-ga', label: 'GA-зона', group: 'Планировка' },
  { id: 'stage', label: 'Сцена', group: 'Планировка' },
  { id: 'label', label: 'Подпись', group: 'Планировка' },
  { id: 'obstacle', label: 'Препятствие', group: 'Планировка' },
  { id: 'row-line', label: 'Прямой ряд', group: 'Посадка' },
  { id: 'row-arc', label: 'Дуговой ряд', group: 'Посадка' },
  { id: 'row-bezier', label: 'Ряд Безье', group: 'Посадка' },
  { id: 'seat', label: 'Место', group: 'Посадка' },
  { id: 'table-circle', label: 'Круглый стол', group: 'Мебель' },
  { id: 'table-rectangle', label: 'Прямоугольный стол', group: 'Мебель' },
  { id: 'calibrate', label: 'Калибровать', group: 'Сервис' },
];

function ToolIcon({ tool }: { tool: EditorTool }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.7,
  };
  let icon: ReactNode;
  switch (tool) {
    case 'select':
      icon = <path d="M5 3.5 18 14l-5.3 1.1L15 21l-2.2 1-2.4-5.8L7 20z" />;
      break;
    case 'pan':
      icon = (
        <path d="M7 11V5a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7h-1c-2.2 0-3.6-.8-4.8-2.7L4 14a1.8 1.8 0 0 1 3-2z" />
      );
      break;
    case 'zone':
    case 'zone-ga':
      icon = (
        <>
          <path d="m4 7 14-3 3 13-14 3z" />
          {tool === 'zone-ga' && <path d="M9 8v8m4-9v8m4-9v8" />}
        </>
      );
      break;
    case 'stage':
      icon = (
        <>
          <path d="M4 7h16v10H4z" />
          <path d="M7 4h10M7 20h10" />
        </>
      );
      break;
    case 'label':
      icon = (
        <>
          <path d="M5 5h14M12 5v14" />
          <path d="m8 19 4-9 4 9" />
        </>
      );
      break;
    case 'obstacle':
      icon = (
        <>
          <path d="m12 3 9 9-9 9-9-9z" />
          <path d="M8 16 16 8" />
        </>
      );
      break;
    case 'row-line':
      icon = (
        <>
          <path d="M4 5h16M4 12h16M4 19h16" />
          <circle cx="6" cy="5" r="1" />
          <circle cx="12" cy="5" r="1" />
          <circle cx="18" cy="5" r="1" />
        </>
      );
      break;
    case 'row-arc':
      icon = (
        <>
          <path d="M4 17Q12 3 20 17" />
          <circle cx="6" cy="13" r="1" />
          <circle cx="12" cy="7" r="1" />
          <circle cx="18" cy="13" r="1" />
        </>
      );
      break;
    case 'row-bezier':
      icon = (
        <>
          <path d="M4 18C7 4 17 4 20 18" />
          <circle cx="4" cy="18" r="1" />
          <circle cx="12" cy="9" r="1" />
          <circle cx="20" cy="18" r="1" />
        </>
      );
      break;
    case 'seat':
      icon = (
        <>
          <rect x="7" y="5" width="10" height="11" rx="2" />
          <path d="M5 7v9m14-9v9M8 19h8" />
        </>
      );
      break;
    case 'table-circle':
      icon = (
        <>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 1v3m0 16v3M1 12h3m16 0h3" />
        </>
      );
      break;
    case 'table-rectangle':
      icon = (
        <>
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <path d="M8 18v3m8-3v3" />
        </>
      );
      break;
    case 'calibrate':
      icon = (
        <>
          <path d="M4 17 20 7" />
          <path d="m7 15 2 3m2-6 2 3m2-6 2 3" />
        </>
      );
      break;
  }
  return (
    <svg
      aria-hidden="true"
      className="hall-editor-tool-icon"
      viewBox="0 0 24 24"
      {...common}
    >
      {icon}
    </svg>
  );
}

export function ToolsPanel({
  activeTool,
  readonly,
  onSelect,
  locale,
}: {
  activeTool: EditorTool;
  readonly: boolean;
  onSelect: (tool: EditorTool) => void;
  locale?: string | undefined;
}) {
  const groups = [...new Set(editorTools.map((item) => item.group))];
  return (
    <nav
      className="hall-editor-tool-rail"
      aria-label={editorText(locale, 'Инструменты холста')}
    >
      {groups.map((group) => (
        <div
          className="hall-editor-tool-group"
          role="group"
          aria-label={editorText(locale, group)}
          key={group}
        >
          {editorTools
            .filter((item) => item.group === group)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                title={`${editorText(locale, item.label)}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                aria-label={`${editorText(locale, item.label)}${item.shortcut ? ` (${item.shortcut})` : ''}`}
                aria-keyshortcuts={item.shortcut}
                aria-pressed={activeTool === item.id}
                disabled={readonly && item.id !== 'select' && item.id !== 'pan'}
                onClick={() => onSelect(item.id)}
              >
                <ToolIcon tool={item.id} />
                {item.shortcut && (
                  <kbd className="hall-editor-shortcut">{item.shortcut}</kbd>
                )}
              </button>
            ))}
        </div>
      ))}
    </nav>
  );
}

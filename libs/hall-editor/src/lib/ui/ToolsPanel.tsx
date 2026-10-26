import type { EditorTool } from '../editorOperations.js';
import { editorText } from './editorI18n.js';

export const editorTools: readonly {
  id: EditorTool;
  label: string;
  glyph: string;
  shortcut?: string;
}[] = [
  { id: 'select', label: 'Выбор', glyph: '↖', shortcut: 'V' },
  { id: 'pan', label: 'Рука', glyph: '✥', shortcut: 'H' },
  { id: 'zone', label: 'Зона', glyph: '▱' },
  { id: 'zone-ga', label: 'GA-зона', glyph: '◫' },
  { id: 'stage', label: 'Сцена', glyph: '▰' },
  { id: 'label', label: 'Подпись', glyph: 'T' },
  { id: 'obstacle', label: 'Препятствие', glyph: '◆' },
  { id: 'row-line', label: 'Прямой ряд', glyph: '▤' },
  { id: 'row-arc', label: 'Дуговой ряд', glyph: '⌒' },
  { id: 'row-bezier', label: 'Ряд Безье', glyph: '〰' },
  { id: 'seat', label: 'Место', glyph: '▣' },
  { id: 'table-circle', label: 'Круглый стол', glyph: '◉' },
  { id: 'table-rectangle', label: 'Прямоугольный стол', glyph: '▭' },
  { id: 'calibrate', label: 'Калибровать', glyph: '⌁' },
];

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
  return (
    <nav
      className="hall-editor-tool-rail"
      aria-label={editorText(locale, 'Инструменты холста')}
    >
      {editorTools.map((item) => (
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
          <span className="hall-editor-tool-glyph" aria-hidden="true">
            {item.glyph}
          </span>
          {item.shortcut && (
            <kbd className="hall-editor-shortcut">{item.shortcut}</kbd>
          )}
        </button>
      ))}
    </nav>
  );
}

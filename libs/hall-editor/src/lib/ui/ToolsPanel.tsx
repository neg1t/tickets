import type { EditorTool } from '../editorOperations.js';

export const editorTools: readonly {
  id: EditorTool;
  label: string;
  glyph: string;
}[] = [
  { id: 'select', label: 'Выбор', glyph: '↖' },
  { id: 'pan', label: 'Рука', glyph: '✥' },
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
}: {
  activeTool: EditorTool;
  readonly: boolean;
  onSelect: (tool: EditorTool) => void;
}) {
  return (
    <nav className="hall-editor-tool-rail" aria-label="Инструменты холста">
      {editorTools.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-pressed={activeTool === item.id}
          disabled={readonly && item.id !== 'select' && item.id !== 'pan'}
          onClick={() => onSelect(item.id)}
        >
          <span aria-hidden="true">{item.glyph}</span>
        </button>
      ))}
    </nav>
  );
}

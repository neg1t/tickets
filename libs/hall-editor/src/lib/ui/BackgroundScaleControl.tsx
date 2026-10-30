import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { editorText } from './editorI18n.js';

type Props = Readonly<{
  value: number;
  disabled: boolean;
  locale?: string;
  onCommit: (value: number) => void;
  onPreview?: (value: number | null) => void;
}>;

export function BackgroundScaleControl({
  value,
  disabled,
  locale,
  onCommit,
  onPreview,
}: Props) {
  const [draftState, setDraftState] = useState({ sourceValue: value, draft: String(value) });
  const draft = draftState.sourceValue === value ? draftState.draft : String(value);
  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed > 0;
  const rangeValue = Math.max(10, valid ? parsed : value);
  const max = Math.max(400, Math.ceil(rangeValue / 100) * 100);

  function updateDraft(next: string) {
    setDraftState({ sourceValue: value, draft: next });
  }

  function commit(next: number) {
    if (!Number.isFinite(next) || next <= 0) return;
    if (next === value) return;
    onCommit(next);
  }

  return (
    <fieldset className="hall-editor-background-scale" disabled={disabled}>
      <legend>{editorText(locale, 'Масштаб подложки')}</legend>
      <input
        aria-label={editorText(locale, 'Масштаб подложки')}
        type="range"
        min={10}
        max={max}
        step={1}
        value={Math.min(max, rangeValue)}
        onChange={(event) => {
          updateDraft(event.currentTarget.value);
          onPreview?.(Number(event.currentTarget.value));
        }}
        onPointerUp={() => {
          commit(Number(draft));
          onPreview?.(null);
        }}
        onPointerCancel={() => {
          updateDraft(String(value));
          onPreview?.(null);
        }}
        onKeyUp={(event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            commit(Number(draft));
            onPreview?.(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            updateDraft(String(value));
            onPreview?.(null);
          }
        }}
      />
      <div className="hall-editor-background-scale-actions">
        <button type="button" aria-label={editorText(locale, 'Уменьшить')} onClick={() => commit(rangeValue - 1)}>
          −
        </button>
        <input
          aria-label={editorText(locale, 'Масштаб подложки')}
          type="number"
          min="0.01"
          step="any"
          value={draft}
          onChange={(event) => updateDraft(event.currentTarget.value)}
          onBlur={() => { if (valid) commit(parsed); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <span>%</span>
        <button type="button" aria-label={editorText(locale, 'Увеличить')} onClick={() => commit(rangeValue + 1)}>
          +
        </button>
        <button type="button" onClick={() => commit(100)}>
          {editorText(locale, 'Сбросить')}
        </button>
      </div>
    </fieldset>
  );
}

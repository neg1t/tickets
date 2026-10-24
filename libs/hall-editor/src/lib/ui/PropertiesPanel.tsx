import { useContext, useId, useState, type ReactNode } from 'react';
import { parsePropertyValue } from './propertyValidation.js';
import {
  EditorLocaleContext,
  editorText,
  translateEditorError,
} from './editorI18n.js';

export function PropertiesPanel({
  mobileOpen,
  onClose,
  children,
  locale,
}: {
  readonly mobileOpen: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly locale?: string | undefined;
}) {
  return (
    <aside
      className="hall-editor-properties"
      aria-label={editorText(locale, 'Свойства объекта')}
      data-mobile-open={mobileOpen}
    >
      <div className="hall-editor-panel-heading">
        <h3>{editorText(locale, 'Свойства')}</h3>
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

export type PropertyFieldProps = {
  readonly label: string;
  readonly value: string | number | null;
  readonly disabled?: boolean;
  readonly kind?: 'text' | 'number';
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  readonly locale?: string | undefined;
  readonly onCommit: (value: string | number) => void;
};

function inferredUnit(
  label: string,
  kind: 'text' | 'number',
): string | undefined {
  if (kind === 'text') return undefined;
  if (label.includes('(рад)')) return 'рад';
  if (label.includes('(rad)')) return 'rad';
  if (label.includes('(°)')) return '°';
  if (
    /^(X|Y)\b|^(Начало|Конец|Центр|Start|End|Center) [XY]\b|^(Ширина|Высота|Радиус)\b|\b(width|height|radius)\b/i.test(
      label,
    )
  )
    return 'ед.';
  return undefined;
}

export function PropertyField(props: PropertyFieldProps) {
  return (
    <PropertyFieldInput key={`${props.label}:${props.value}`} {...props} />
  );
}

function PropertyFieldInput(props: PropertyFieldProps) {
  const contextLocale = useContext(EditorLocaleContext);
  const locale = props.locale ?? contextLocale;
  const { label, value, disabled, onCommit } = props;
  const kind = props.kind ?? (typeof value === 'number' ? 'number' : 'text');
  const unit = props.unit ?? inferredUnit(label, kind);
  const min =
    props.min ??
    (/^(Ширина|Высота|Радиус|Масштаб|Вместимость)|\b(width|height|radius|scale|capacity)\b/i.test(
      label,
    )
      ? 0.001
      : undefined);
  const [raw, setRaw] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const displayLabel = editorText(locale, label);

  function commit() {
    const parsed = parsePropertyValue(raw, kind, {
      ...(min !== undefined ? { min } : {}),
      ...(props.max !== undefined ? { max: props.max } : {}),
      ...(props.integer !== undefined ? { integer: props.integer } : {}),
    });
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    if (parsed.value !== value) onCommit(parsed.value);
  }

  return (
    <label className="hall-editor-field">
      <span>
        {displayLabel}
        {unit && (
          <small className="hall-editor-unit">
            {' '}
            · {editorText(locale, unit)}
          </small>
        )}
      </span>
      <input
        aria-label={displayLabel}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        type={kind === 'number' ? 'number' : 'text'}
        step={kind === 'number' ? (props.integer ? 1 : 'any') : undefined}
        value={raw}
        placeholder={
          value === null ? editorText(locale, 'Разные значения') : undefined
        }
        disabled={disabled}
        onChange={(event) => {
          setRaw(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setRaw(value === null ? '' : String(value));
            setError(null);
            event.currentTarget.blur();
          }
        }}
        onBlur={commit}
      />
      {error && (
        <small id={errorId} role="alert" className="hall-editor-field-error">
          {translateEditorError(locale, error)}
        </small>
      )}
    </label>
  );
}

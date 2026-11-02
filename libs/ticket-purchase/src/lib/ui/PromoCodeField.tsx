import { useId } from 'react';
import { Button } from '@hall-platform/ui';

export type PromoStatus = 'idle' | 'editing' | 'applying' | 'applied' | 'invalid';

export type PromoCodeFieldProps = Readonly<{
  value: string;
  appliedCode?: string;
  status: PromoStatus;
  locale: string;
  error?: string | null;
  disabled?: boolean;
  applying?: boolean;
  onChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}>;

export function PromoCodeField({
  value,
  appliedCode,
  status,
  locale,
  error,
  disabled = false,
  applying = false,
  onChange,
  onApply,
  onClear,
}: PromoCodeFieldProps) {
  const english = locale.toLowerCase().startsWith('en');
  const id = `tp-promo-${useId().replace(/:/g, '')}`;
  const isApplied = status === 'applied' && Boolean(appliedCode);
  const showRemove = Boolean(appliedCode) && (isApplied || !value.trim());
  return (
    <section className="tp-promo" aria-label={english ? 'Promotion code' : 'Промокод'}>
      <label className="tp-promo__label" htmlFor={id}>
        {english ? 'Promotion code' : 'Промокод'}
      </label>
      <div className="tp-promo__controls">
        <input
          id={id}
          type="text"
          value={value}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={status === 'invalid' || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {showRemove ? (
          <Button tone="quiet" disabled={disabled || applying || status === 'applying'} onClick={onClear}>
            {english ? 'Remove' : 'Удалить'}
          </Button>
        ) : (
          <Button tone="secondary" disabled={disabled || applying || status === 'applying' || !value.trim()} onClick={onApply}>
            {applying || status === 'applying'
              ? english ? 'Applying…' : 'Применяем…'
              : english ? 'Apply' : 'Применить'}
          </Button>
        )}
      </div>
      {error ? <p className="tp-promo__error" id={`${id}-error`} role="alert">{error}</p> : null}
      {isApplied ? <p className="tp-promo__success" role="status">{english ? `Code ${appliedCode} applied.` : `Промокод ${appliedCode} применён.`}</p> : null}
    </section>
  );
}

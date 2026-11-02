import type { BuyerOtpChallenge } from '@hall-platform/api-contracts';
import { Button, Field } from '@hall-platform/ui';
import { PurchaseDialog } from './PurchaseDialog.js';

export type EmailVerificationDialogProps = Readonly<{
  open: boolean;
  locale: string;
  challenge: BuyerOtpChallenge | null;
  code: string;
  busy: boolean;
  error: string | null;
  now: number;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onClose: () => void;
}>;

export function EmailVerificationDialog({
  open,
  locale,
  challenge,
  code,
  busy,
  error,
  now,
  onCodeChange,
  onVerify,
  onResend,
  onClose,
}: EmailVerificationDialogProps) {
  const english = locale.toLowerCase().startsWith('en');
  const cooldownMs = challenge ? Math.max(0, Date.parse(challenge.resendAvailableAt) - now) : 0;
  const cooldownSeconds = Math.ceil(cooldownMs / 1000);
  const resendAvailable = !challenge || cooldownMs === 0;
  const canVerify = Boolean(challenge && code.length === challenge.codeLength && challenge.attemptsRemaining > 0);

  return (
    <PurchaseDialog
      open={open}
      title={english ? 'Verify your email' : 'Подтвердите почту'}
      closeLabel={english ? 'Close email verification' : 'Закрыть подтверждение почты'}
      onClose={onClose}
      className="tp-email-verification-dialog"
    >
      <p className="tp-email-verification__description">
        {challenge
          ? english
            ? `Enter the ${challenge.codeLength}-digit code sent to ${challenge.destinationMasked}.`
            : `Введите код из ${challenge.codeLength} цифр, отправленный на ${challenge.destinationMasked}.`
          : english ? 'Send a one-time code to your email address.' : 'Отправьте одноразовый код на вашу почту.'}
      </p>
      {challenge ? (
        <Field
          label={english ? 'Verification code' : 'Код подтверждения'}
          value={code}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={challenge.codeLength}
          disabled={busy || challenge.attemptsRemaining === 0}
          onChange={(event) => onCodeChange(event.currentTarget.value.replace(/\D/g, '').slice(0, challenge.codeLength))}
          {...(error ? { error } : {})}
        />
      ) : null}
      {error && !challenge ? <p className="tp-email-verification__error" role="alert">{error}</p> : null}
      {challenge && challenge.attemptsRemaining === 0 ? (
        <p className="tp-email-verification__error" role="alert">
          {english ? 'No attempts remain. Request a new code when available.' : 'Попытки закончились. Запросите новый код, когда это станет доступно.'}
        </p>
      ) : null}
      {challenge && cooldownSeconds > 0 ? (
        <p className="tp-email-verification__cooldown" aria-live="polite">
          {english ? `You can request another code in ${cooldownSeconds}s.` : `Повторный код можно запросить через ${cooldownSeconds} с.`}
        </p>
      ) : null}
      <div className="tp-dialog-actions">
        <Button tone="quiet" disabled={busy || !resendAvailable} onClick={onResend}>
          {challenge
            ? english ? 'Resend code' : 'Отправить код ещё раз'
            : english ? 'Send code' : 'Отправить код'}
        </Button>
        {challenge ? (
          <Button tone="primary" disabled={busy || !canVerify} onClick={onVerify}>
            {busy ? english ? 'Checking…' : 'Проверяем…' : english ? 'Verify' : 'Подтвердить'}
          </Button>
        ) : null}
      </div>
    </PurchaseDialog>
  );
}

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { BuyerContact, BuyerEmailVerification, BuyerOtpChallenge } from '@hall-platform/api-contracts';
import { BuyerApiError } from '@hall-platform/api-axios';
import { Button, Field } from '@hall-platform/ui';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';
import { useTicketPurchaseController } from '../model/useTicketPurchase.js';
import {
  contactFieldErrorsFromApi,
  normalizeContactDraft,
  validateContactDraft,
  type ContactField,
  type ContactFieldErrors,
} from '../model/contactValidation.js';
import { PurchaseLayout } from './PurchaseLayout.js';
import { EmailVerificationDialog } from './EmailVerificationDialog.js';
import { HoldTimer } from './HoldTimer.js';
import { HoldNotice } from './HoldNotice.js';
import { HoldExpiredDialog } from './HoldExpiredDialog.js';

type BusyState = 'saving' | 'requesting' | 'verifying' | null;

function withPrefill(prefill: Partial<BuyerContact>): BuyerContact {
  return {
    firstName: prefill.firstName ?? '',
    lastName: prefill.lastName ?? '',
    phone: prefill.phone ?? '',
    email: prefill.email ?? '',
  };
}

function newIdempotencyKey(operation: string): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${operation}-${random}`;
}

function errorMessage(error: unknown, locale: string): string {
  if (error instanceof BuyerApiError) {
    if (error.code === 'hold_expired') {
      return locale.toLowerCase().startsWith('en')
        ? 'The ticket reservation expired. Refresh ticket availability before continuing.'
        : 'Время резерва истекло. Обновите наличие билетов, чтобы продолжить.';
    }
    if (error.code === 'verification_required') {
      return locale.toLowerCase().startsWith('en')
        ? 'Verify this email address before continuing.'
        : 'Подтвердите этот адрес электронной почты, чтобы продолжить.';
    }
  }
  return error instanceof Error
    ? error.message
    : locale.toLowerCase().startsWith('en') ? 'Something went wrong. Try again.' : 'Что-то пошло не так. Попробуйте ещё раз.';
}

function sameContact(left: BuyerContact, right: BuyerContact): boolean {
  return left.firstName === right.firstName && left.lastName === right.lastName &&
    left.phone === right.phone && left.email === right.email;
}

export type ContactDetailsFormProps = Readonly<{
  className?: string;
  onContinueToPayment?: (contact: BuyerContact) => void;
}>;

/** Contact and email verification step for a single active purchase session. */
export function ContactDetailsForm({ className = '', onContinueToPayment }: ContactDetailsFormProps) {
  const purchase = useTicketPurchase();
  const { controller, snapshot } = useTicketPurchaseController();
  const sessionId = snapshot.purchaseSessionId;
  const occurrenceId = snapshot.occurrence?.occurrenceId;
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const formRefValue = useRef<BuyerContact>(withPrefill(purchase.contactPrefill));
  const saveKeyRef = useRef<string | null>(null);
  const emailKeyRef = useRef<string | null>(null);
  const verifyKeyRef = useRef<{ payload: string; key: string } | null>(null);
  const otpSequence = useRef(0);
  const otpRequest = useRef<AbortController | null>(null);
  const rejectedCodePayloads = useRef(new Set<string>());
  const [form, setForm] = useState<BuyerContact>(() => withPrefill(purchase.contactPrefill));
  const [contactRevision, setContactRevision] = useState(0);
  const [emailVerification, setEmailVerification] = useState<BuyerEmailVerification | null>(null);
  const [challenge, setChallenge] = useState<BuyerOtpChallenge | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ContactFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resumedSessionId, setResumedSessionId] = useState<string | null>(null);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const [busy, setBusy] = useState<BusyState>(null);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [holdExpired, setHoldExpired] = useState(false);
  const [expiryRefreshBusy, setExpiryRefreshBusy] = useState(false);
  const [expiryRefreshError, setExpiryRefreshError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const english = purchase.locale.toLowerCase().startsWith('en');

  useEffect(() => {
    if (!sessionId) return;
    const request = new AbortController();
    let active = true;
    void purchase.dataSource.resumeSession(sessionId, request.signal).then((resume) => {
      if (!active) return;
      if (resume.purchaseSessionId !== sessionId || resume.occurrenceId !== occurrenceId) {
        throw new BuyerApiError('invalid_response', 'The resumed purchase session does not match this event time');
      }
      const next = resume.contact ?? withPrefill(purchase.contactPrefill);
      formRefValue.current = next;
      setForm(next);
      setContactRevision(resume.contactRevision);
      setEmailVerification(resume.emailVerification);
      setChallenge(null);
      setVerificationCode('');
      setLoadError(null);
      setResumedSessionId(sessionId);
      setBusy(null);
    }).catch((cause: unknown) => {
      if (!active || request.signal.aborted) return;
      setLoadError(errorMessage(cause, purchase.locale));
      setResumedSessionId(sessionId);
      setBusy(null);
    });
    return () => {
      active = false;
      request.abort();
    };
  }, [occurrenceId, purchase.contactPrefill, purchase.dataSource, purchase.locale, resumeAttempt, sessionId]);

  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  useEffect(() => {
    if (!sessionId || snapshot.hold?.status !== 'active') return;
    const refreshHold = () => {
      if (document.visibilityState !== 'hidden') void controller.retry();
    };
    const refreshFromHost = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
      if (detail?.instanceId === purchase.instanceId) refreshHold();
    };
    window.addEventListener('focus', refreshHold);
    window.addEventListener('pageshow', refreshHold);
    window.addEventListener('online', refreshHold);
    document.addEventListener('visibilitychange', refreshHold);
    window.addEventListener('ticket-purchase:resume', refreshFromHost);
    return () => {
      window.removeEventListener('focus', refreshHold);
      window.removeEventListener('pageshow', refreshHold);
      window.removeEventListener('online', refreshHold);
      document.removeEventListener('visibilitychange', refreshHold);
      window.removeEventListener('ticket-purchase:resume', refreshFromHost);
    };
  }, [controller, purchase.instanceId, sessionId, snapshot.hold?.id, snapshot.hold?.status]);

  function continueToPayment(contact: BuyerContact) {
    setError(null);
    setBusy(null);
    purchase.setStep('payment');
    onContinueToPayment?.(contact);
  }

  function handleApiFailure(cause: unknown) {
    if (cause instanceof BuyerApiError && cause.code === 'hold_expired') {
      setHoldExpired(true);
      setExpiryRefreshError(null);
      setExpiryRefreshBusy(true);
      void controller.retry().then(() => {
        const refreshed = controller.getSnapshot();
        if (refreshed.error) setExpiryRefreshError(refreshed.error);
      }).finally(() => setExpiryRefreshBusy(false));
      setVerificationOpen(false);
      setError(null);
      return;
    }
    if (cause instanceof BuyerApiError && cause.fieldErrors?.length) {
      const apiErrors = contactFieldErrorsFromApi(cause.fieldErrors);
      setFieldErrors(apiErrors);
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      setError(null);
      return;
    }
    setError(errorMessage(cause, purchase.locale));
  }

  async function requestEmailCode(email: string) {
    if (!sessionId) return;
    const submittedEmail = email.trim();
    const sequence = ++otpSequence.current;
    otpRequest.current?.abort();
    const request = new AbortController();
    otpRequest.current = request;
    setVerificationOpen(true);
    setBusy('requesting');
    setError(null);
    const key = emailKeyRef.current ?? newIdempotencyKey('buyer-email-challenge');
    emailKeyRef.current = key;
    try {
      const result = await purchase.dataSource.requestEmail(sessionId, submittedEmail, key, request.signal);
      if (sequence !== otpSequence.current || request.signal.aborted || formRefValue.current.email.trim() !== submittedEmail) return;
      setChallenge(result);
      setVerificationCode('');
      rejectedCodePayloads.current.clear();
      emailKeyRef.current = null;
      verifyKeyRef.current = null;
      setBusy(null);
    } catch (cause) {
      if (sequence !== otpSequence.current || request.signal.aborted) return;
      handleApiFailure(cause);
      setBusy(null);
    }
  }

  async function saveAndContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || busy === 'saving' || busy === 'requesting' || busy === 'verifying') return;
    const contact = normalizeContactDraft(formRefValue.current);
    const validation = validateContactDraft(contact, purchase.locale);
    setFieldErrors(validation);
    setError(null);
    const firstInvalid = (['firstName', 'lastName', 'phone', 'email'] as const).find((field) => validation[field]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`[id="${formId}-${firstInvalid}"]`)?.focus();
      return;
    }
    if (!snapshot.hold || snapshot.hold.status !== 'active') {
      setHoldExpired(true);
      return;
    }
    const submitted = contact;
    const key = saveKeyRef.current ?? newIdempotencyKey('buyer-contact');
    saveKeyRef.current = key;
    setBusy('saving');
    try {
      const saved = await purchase.dataSource.saveContact(sessionId, submitted, contactRevision, key);
      saveKeyRef.current = null;
      setContactRevision(saved.contactRevision);
      setEmailVerification(saved.emailVerification);
      if (!sameContact(formRefValue.current, submitted)) {
        setBusy(null);
        setError(english
          ? 'Your details changed while they were saving. Continue again to save the latest version.'
          : 'Данные изменились во время сохранения. Нажмите «Продолжить» ещё раз, чтобы сохранить актуальную версию.');
        return;
      }
      const savedContact = saved.contact ?? submitted;
      formRefValue.current = savedContact;
      setForm(savedContact);
      const mustVerify = snapshot.context?.capabilities.emailVerification === true;
      const verified = saved.emailVerification?.status === 'verified' &&
        saved.emailVerification.verifiedEmail === savedContact.email;
      if (!mustVerify || verified) {
        continueToPayment(savedContact);
        return;
      }
      setBusy(null);
      if (challenge && formRefValue.current.email.trim() === savedContact.email) {
        setVerificationOpen(true);
        return;
      }
      await requestEmailCode(savedContact.email);
    } catch (cause) {
      if (cause instanceof BuyerApiError && cause.code === 'revision_conflict') {
        try {
          const resume = await purchase.dataSource.resumeSession(sessionId);
          if (resume.purchaseSessionId === sessionId && resume.occurrenceId === occurrenceId) {
            setContactRevision(resume.contactRevision);
            setEmailVerification(resume.emailVerification);
            if (sameContact(formRefValue.current, submitted) && resume.contact) {
              formRefValue.current = resume.contact;
              setForm(resume.contact);
            }
          }
        } catch {
          // The original revision error remains actionable; a later submit can retry the resume.
        }
        setError(english
          ? 'Your saved contact details changed. Review the form and continue again.'
          : 'Сохранённые контактные данные изменились. Проверьте форму и нажмите «Продолжить» ещё раз.');
        setBusy(null);
        return;
      }
      handleApiFailure(cause);
      setBusy(null);
    }
  }

  async function verifyEmailCode() {
    if (!sessionId || !challenge || busy || verificationCode.length !== challenge.codeLength) return;
    const challengeId = challenge.challengeId;
    const email = formRefValue.current.email.trim();
    const contactAtVerify = formRefValue.current;
    const payload = `${challengeId}:${verificationCode}`;
    const key = verifyKeyRef.current?.payload === payload
      ? verifyKeyRef.current.key
      : newIdempotencyKey('buyer-email-verify');
    verifyKeyRef.current = { payload, key };
    const sequence = otpSequence.current;
    const request = new AbortController();
    otpRequest.current?.abort();
    otpRequest.current = request;
    setBusy('verifying');
    setError(null);
    try {
      const result = await purchase.dataSource.verifyEmail(sessionId, challengeId, verificationCode, key, request.signal);
      if (sequence !== otpSequence.current || request.signal.aborted || formRefValue.current.email.trim() !== email) return;
      const verified = result.emailVerification?.status === 'verified' && result.emailVerification.verifiedEmail === email;
      if (!verified) {
        setBusy(null);
        setError(english ? 'The server has not verified this email address yet.' : 'Сервер пока не подтвердил этот адрес электронной почты.');
        return;
      }
      setContactRevision(result.contactRevision);
      setEmailVerification(result.emailVerification);
      verifyKeyRef.current = null;
      setVerificationOpen(false);
      if (!sameContact(formRefValue.current, contactAtVerify)) {
        setBusy(null);
        setError(english
          ? 'Your contact details changed during verification. Continue again to save the latest version.'
          : 'Контактные данные изменились во время подтверждения. Нажмите «Продолжить» ещё раз, чтобы сохранить актуальную версию.');
        return;
      }
      const savedContact = result.contact ?? formRefValue.current;
      formRefValue.current = savedContact;
      setForm(savedContact);
      continueToPayment(savedContact);
    } catch (cause) {
      if (sequence !== otpSequence.current || request.signal.aborted) return;
      if (cause instanceof BuyerApiError && cause.code === 'invalid_code' && !rejectedCodePayloads.current.has(payload)) {
        rejectedCodePayloads.current.add(payload);
        setChallenge((current) => current
          ? { ...current, attemptsRemaining: Math.max(0, current.attemptsRemaining - 1) }
          : current);
      }
      handleApiFailure(cause);
      setBusy(null);
    }
  }

  function handleFieldChange(field: ContactField, value: string) {
    const previousEmail = formRefValue.current.email.trim();
    const next = { ...formRefValue.current, [field]: value };
    formRefValue.current = next;
    setForm(next);
    saveKeyRef.current = null;
    setFieldErrors((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
    setError(null);
    if (field === 'email' && value.trim() !== previousEmail) {
      otpSequence.current += 1;
      otpRequest.current?.abort();
      otpRequest.current = null;
      emailKeyRef.current = null;
      verifyKeyRef.current = null;
      if (value.trim() !== emailVerification?.verifiedEmail) setEmailVerification(null);
      setChallenge(null);
      setVerificationCode('');
      setVerificationOpen(false);
      if (busy === 'requesting' || busy === 'verifying') setBusy(null);
    }
  }

  async function backToTickets() {
    const released = await controller.releaseHoldForSelection();
    if (released) purchase.setStep('selection');
    else setError(snapshot.error ?? (english ? 'Could not release the reservation.' : 'Не удалось снять резерв.'));
  }

  async function returnAfterExpiry() {
    if (expiryRefreshBusy) return;
    setExpiryRefreshBusy(true);
    setExpiryRefreshError(null);
    try {
      await controller.retry();
      const refreshed = controller.getSnapshot();
      if (refreshed.error) {
        setExpiryRefreshError(refreshed.error);
        return;
      }
      const freshHold = refreshed.hold;
      const freshServerTime = freshHold?.serverTime ?? refreshed.context?.serverTime;
      if (freshHold?.status === 'active' && freshServerTime && Date.parse(freshHold.expiresAt) > Date.parse(freshServerTime)) {
        setHoldExpired(false);
        setVerificationOpen(false);
        return;
      }
      setHoldExpired(false);
      setVerificationOpen(false);
      purchase.setStep('selection');
    } catch (cause) {
      setExpiryRefreshError(errorMessage(cause, purchase.locale));
    } finally {
      setExpiryRefreshBusy(false);
    }
  }

  function handleTimerExpiry() {
    const expiredHoldId = snapshot.hold?.id;
    setHoldExpired(true);
    setExpiryRefreshError(null);
    setExpiryRefreshBusy(true);
    void controller.retry().then(() => {
      if (controller.getSnapshot().hold?.id !== expiredHoldId) return;
      const refreshed = controller.getSnapshot();
      if (refreshed.error) {
        setExpiryRefreshError(refreshed.error);
        return;
      }
      const freshHold = refreshed.hold;
      const freshServerTime = freshHold?.serverTime ?? refreshed.context?.serverTime;
      if (freshHold?.status === 'active' && freshServerTime && Date.parse(freshHold.expiresAt) > Date.parse(freshServerTime)) {
        setHoldExpired(false);
      }
    }).catch((cause: unknown) => {
      setExpiryRefreshError(errorMessage(cause, purchase.locale));
    }).finally(() => setExpiryRefreshBusy(false));
  }

  const headerContent = snapshot.hold?.status === 'active' ? (
    <div className="tp-contact-header">
      <p>{english ? 'Check your contact details before payment.' : 'Проверьте ваши контактные данные и перейдите к оплате.'}</p>
      <HoldTimer key={`${snapshot.hold.id}:${snapshot.hold.serverTime}`} expiresAt={snapshot.hold.expiresAt} serverTime={snapshot.hold.serverTime} locale={purchase.locale} onExpire={handleTimerExpiry} />
      <HoldNotice locale={purchase.locale} />
    </div>
  ) : null;

  if (!sessionId || !snapshot.hold || snapshot.hold.status !== 'active') {
    return (
      <PurchaseLayout {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})} className={className}>
        <section className="tp-contact-guard" role="alert">
          <h3>{english ? 'Tickets are not reserved' : 'Билеты не зарезервированы'}</h3>
          <p>{english ? 'Select tickets and reserve them before entering contact details.' : 'Выберите билеты и создайте резерв, прежде чем вводить контактные данные.'}</p>
          {error || snapshot.error ? <p role="alert">{error ?? snapshot.error}</p> : null}
          <Button tone="secondary" onClick={() => { purchase.setStep('selection'); void controller.retry(); }}>
            {english ? 'Return to ticket selection' : 'Вернуться к выбору билетов'}
          </Button>
        </section>
      </PurchaseLayout>
    );
  }

  if (resumedSessionId !== sessionId) {
    return <PurchaseLayout {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})} loading className={className} headerContent={headerContent} />;
  }

  if (loadError) {
    return (
      <PurchaseLayout {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})} className={className} headerContent={headerContent}>
        <section className="tp-contact-guard" role="alert">
          <h3>{english ? 'Could not restore your contact details' : 'Не удалось восстановить контактные данные'}</h3>
          <p>{loadError}</p>
          <Button tone="secondary" onClick={() => setResumeAttempt((attempt) => attempt + 1)}>
            {english ? 'Try again' : 'Попробовать снова'}
          </Button>
        </section>
      </PurchaseLayout>
    );
  }

  return (
    <PurchaseLayout
      {...(snapshot.occurrence ? { occurrence: snapshot.occurrence } : {})}
      className={className}
      headerContent={headerContent}
      backAction={{ label: english ? 'Back to ticket selection' : 'Назад к выбору билетов', onClick: () => void backToTickets() }}
    >
      <form className="tp-contact-form" ref={formRef} onSubmit={(event) => void saveAndContinue(event)} noValidate>
        <div className="tp-contact-form__grid">
          <Field
            id={`${formId}-firstName`}
            label={english ? 'First name' : 'Имя'}
            name="given-name"
            autoComplete="given-name"
            value={form.firstName}
            onChange={(event) => handleFieldChange('firstName', event.currentTarget.value)}
            {...(fieldErrors.firstName ? { error: fieldErrors.firstName } : {})}
          />
          <Field
            id={`${formId}-lastName`}
            label={english ? 'Last name' : 'Фамилия'}
            name="family-name"
            autoComplete="family-name"
            value={form.lastName}
            onChange={(event) => handleFieldChange('lastName', event.currentTarget.value)}
            {...(fieldErrors.lastName ? { error: fieldErrors.lastName } : {})}
          />
          <Field
            id={`${formId}-phone`}
            label={english ? 'Phone' : 'Телефон'}
            type="tel"
            name="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(event) => handleFieldChange('phone', event.currentTarget.value)}
            {...(fieldErrors.phone ? { error: fieldErrors.phone } : {})}
          />
          <Field
            id={`${formId}-email`}
            label="Email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => handleFieldChange('email', event.currentTarget.value)}
            {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
          />
        </div>
        {emailVerification?.status === 'verified' && emailVerification.verifiedEmail === form.email ? (
          <p className="tp-contact-form__verified" role="status">{english ? 'Email verified' : 'Почта подтверждена'}</p>
        ) : null}
        {error ? <p className="tp-contact-form__error" role="alert">{error}</p> : null}
        <div className="tp-contact-form__actions">
          <Button tone="primary" type="submit" disabled={busy !== null}>
            {busy === 'saving'
              ? english ? 'Saving…' : 'Сохраняем…'
              : english ? 'Continue' : 'Продолжить'}
          </Button>
        </div>
      </form>
      <EmailVerificationDialog
        open={verificationOpen}
        locale={purchase.locale}
        challenge={challenge}
        code={verificationCode}
        busy={busy === 'requesting' || busy === 'verifying'}
        error={error}
        now={now}
        onCodeChange={(value) => {
          setVerificationCode(value);
          verifyKeyRef.current = null;
          setError(null);
        }}
        onVerify={() => void verifyEmailCode()}
        onResend={() => void requestEmailCode(formRefValue.current.email)}
        onClose={() => setVerificationOpen(false)}
      />
      <HoldExpiredDialog
        open={holdExpired}
        locale={purchase.locale}
        busy={expiryRefreshBusy}
        error={expiryRefreshError}
        onRefresh={() => void returnAfterExpiry()}
      />
    </PurchaseLayout>
  );
}

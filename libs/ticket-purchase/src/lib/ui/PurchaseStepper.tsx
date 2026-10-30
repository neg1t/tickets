import type { PurchaseStep } from '../TicketPurchaseProvider.js';
import { getPurchaseMessages } from '../../i18n/messages.js';

const steps: readonly PurchaseStep[] = [
  'selection',
  'contacts',
  'payment',
  'success',
];

export type PurchaseStepperProps = Readonly<{
  activeStep: PurchaseStep;
  locale?: string;
  className?: string;
}>;

export function PurchaseStepper({
  activeStep,
  locale = 'ru-RU',
  className = '',
}: PurchaseStepperProps) {
  const labels = getPurchaseMessages(locale);
  return (
    <nav
      className={`tp-stepper ${className}`}
      aria-label={locale.toLowerCase().startsWith('en') ? 'Purchase steps' : 'Этапы покупки'}
    >
      <ol>
        {steps.map((step, index) => (
          <li
            key={step}
            aria-label={labels.steps[step]}
            aria-current={activeStep === step ? 'step' : undefined}
            data-active={activeStep === step || undefined}
            data-step={step}
          >
            <span className="tp-stepper__number" aria-hidden="true">{index + 1}</span>
            <span className="tp-stepper__label">{labels.steps[step]}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}


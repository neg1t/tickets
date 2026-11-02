import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';
import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import { Button } from '@hall-platform/ui';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';
import { getPurchaseMessages } from '../../i18n/messages.js';
import { EventSummary } from './EventSummary.js';
import { PurchaseStepper } from './PurchaseStepper.js';

const backArrowUrl = new URL('../../../assets/back-arrow.svg', import.meta.url).href;

export type PurchaseLayoutProps = PropsWithChildren<{
  readonly occurrence?: BuyerOccurrenceSummary;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly className?: string;
  /** Step-specific selectors/countdown rendered before the responsive summary. */
  readonly headerContent?: ReactNode;
  readonly backAction?: Readonly<{ label: string; onClick: () => void }>;
}>;

function themeStyle(theme: ReturnType<typeof useTicketPurchase>['theme']): CSSProperties {
  return {
    '--tp-color-accent': theme.accent,
    '--tp-color-ink': theme.ink,
    '--tp-color-surface': theme.surface,
    '--tp-color-muted': theme.muted,
    '--tp-color-border': theme.border,
    '--tp-color-background': theme.background,
    '--tp-font-family': theme.fontFamily,
    '--tp-radius': theme.radius,
  } as CSSProperties;
}

export function PurchaseLayout({
  occurrence,
  loading = false,
  error = null,
  className = '',
  headerContent,
  backAction,
  children,
}: PurchaseLayoutProps) {
  const purchase = useTicketPurchase();
  const messages = getPurchaseMessages(purchase.locale);
  return (
    <div
      className={`ticket-purchase ${className}`}
      data-ticket-purchase-root
      data-ticket-purchase-instance={purchase.instanceId}
      data-step={purchase.step}
      style={themeStyle(purchase.theme)}
    >
      <div className="tp-layout">
        <header className="tp-layout__header">
          <Button
            className="tp-layout__back"
            tone="quiet"
            onClick={backAction?.onClick ?? purchase.hostActions.onBack}
            disabled={!backAction && !purchase.hostActions.onBack}
          >
            <img className="tp-layout__back-icon" src={backArrowUrl} alt="" aria-hidden="true" />
            {backAction?.label ?? messages.backToEvent}
          </Button>
          <h2 className="tp-layout__title">{messages.steps[purchase.step]}</h2>
          {headerContent && (
            <div className="tp-layout__header-content">{headerContent}</div>
          )}
        </header>
        <aside
          className={`tp-layout__sidebar${occurrence ? '' : ' tp-layout__sidebar--empty'}`}
          aria-label={messages.checkoutTitle}
        >
          <h1 className="tp-layout__sidebar-title">{messages.checkoutTitle}</h1>
          <PurchaseStepper activeStep={purchase.step} locale={purchase.locale} />
          {occurrence && (
            <EventSummary
              occurrence={occurrence}
              locale={purchase.locale}
              {...(purchase.hostActions.onDetails
                ? { onDetails: purchase.hostActions.onDetails }
                : {})}
            />
          )}
        </aside>
        <main className="tp-layout__content" aria-busy={loading}>
          {loading ? (
            <p className="tp-layout__loading" role="status" aria-live="polite">
              {messages.loading}
            </p>
          ) : error ? (
            <div className="tp-layout__error" role="alert">{error}</div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}


import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import type { ReactNode } from 'react';
import { PurchaseLayout } from './ui/PurchaseLayout.js';

export type TicketPurchaseWidgetProps = Readonly<{
  occurrence?: BuyerOccurrenceSummary;
  loading?: boolean;
  error?: string | null;
  className?: string;
  headerContent?: ReactNode;
  children?: ReactNode;
}>;

/** Convenience shell for the active checkout step inside TicketPurchaseProvider. */
export function TicketPurchaseWidget(props: TicketPurchaseWidgetProps) {
  return <PurchaseLayout {...props}>{props.children}</PurchaseLayout>;
}


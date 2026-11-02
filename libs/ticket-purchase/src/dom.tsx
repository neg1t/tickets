import { createRoot, type Root } from 'react-dom/client';
import { TicketPurchaseProvider, type TicketPurchaseProviderProps } from './lib/TicketPurchaseProvider.js';
import { TicketPurchaseWidget, type TicketPurchaseWidgetProps } from './lib/TicketPurchaseWidget.js';
import type { PurchaseDataSource } from './lib/model/purchase.types.js';
import type { BuyerOccurrenceSummary } from '@hall-platform/api-contracts';
import type { ReactNode } from 'react';

export type TicketPurchaseEmbedOptions = Readonly<{
  eventId: string;
  occurrenceId: string;
  dataSource: PurchaseDataSource;
  instanceId?: string;
  locale?: string;
  theme?: TicketPurchaseProviderProps['theme'];
  hostActions?: TicketPurchaseProviderProps['hostActions'];
  contactPrefill?: TicketPurchaseProviderProps['contactPrefill'];
  hostBootstrapCredential?: string;
  initialPurchaseSession?: TicketPurchaseProviderProps['initialPurchaseSession'];
  mapHeight?: number;
  className?: TicketPurchaseWidgetProps['className'];
}>;

export type TicketPurchaseEmbed = Readonly<{
  update: (options: TicketPurchaseEmbedOptions) => void;
  dispose: () => void;
}>;

export type TicketPurchaseWidgetMountOptions = Readonly<{
  dataSource: PurchaseDataSource;
  instanceId?: string;
  locale?: string;
  theme?: TicketPurchaseProviderProps['theme'];
  hostActions?: TicketPurchaseProviderProps['hostActions'];
  contactPrefill?: TicketPurchaseProviderProps['contactPrefill'];
  hostBootstrapCredential?: string;
  initialPurchaseSession?: TicketPurchaseProviderProps['initialPurchaseSession'];
  eventId?: string;
  occurrenceId?: string;
  occurrence?: BuyerOccurrenceSummary;
  mapHeight?: number;
  className?: string;
  children?: ReactNode;
}>;

/** Mount the same purchase flow into a dedicated browser host element. */
export function createTicketPurchaseEmbed(
  element: HTMLElement,
  initialOptions: TicketPurchaseEmbedOptions,
): TicketPurchaseEmbed {
  let options = initialOptions;
  let contextRevision = 0;
  let disposed = false;
  const root: Root = createRoot(element);

  function render() {
    root.render(
      <TicketPurchaseProvider
        key={contextRevision}
        dataSource={options.dataSource}
        {...(options.instanceId ? { instanceId: options.instanceId } : {})}
        {...(options.locale ? { locale: options.locale } : {})}
        {...(options.theme ? { theme: options.theme } : {})}
        {...(options.hostActions ? { hostActions: options.hostActions } : {})}
        {...(options.contactPrefill ? { contactPrefill: options.contactPrefill } : {})}
        {...(options.hostBootstrapCredential ? { hostBootstrapCredential: options.hostBootstrapCredential } : {})}
        {...(options.initialPurchaseSession ? { initialPurchaseSession: options.initialPurchaseSession } : {})}
      >
        <TicketPurchaseWidget
          eventId={options.eventId}
          occurrenceId={options.occurrenceId}
          {...(options.mapHeight === undefined ? {} : { mapHeight: options.mapHeight })}
          {...(options.className ? { className: options.className } : {})}
        />
      </TicketPurchaseProvider>,
    );
  }

  render();
  return {
    update(nextOptions) {
      if (disposed) throw new Error('Ticket purchase embed has been disposed');
      if (nextOptions.eventId !== options.eventId || nextOptions.occurrenceId !== options.occurrenceId ||
          nextOptions.dataSource !== options.dataSource || nextOptions.instanceId !== options.instanceId) {
        contextRevision += 1;
      }
      options = nextOptions;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  };
}

/** Compatibility adapter for hosts that provide their own component composition. */
export function mountTicketPurchaseWidget(
  element: HTMLElement,
  options: TicketPurchaseWidgetMountOptions,
): Readonly<{ unmount: () => void }> {
  const root: Root = createRoot(element);
  let disposed = false;
  root.render(
    <TicketPurchaseProvider
      dataSource={options.dataSource}
      {...(options.instanceId ? { instanceId: options.instanceId } : {})}
      {...(options.locale ? { locale: options.locale } : {})}
      {...(options.theme ? { theme: options.theme } : {})}
      {...(options.hostActions ? { hostActions: options.hostActions } : {})}
      {...(options.contactPrefill ? { contactPrefill: options.contactPrefill } : {})}
      {...(options.hostBootstrapCredential ? { hostBootstrapCredential: options.hostBootstrapCredential } : {})}
      {...(options.initialPurchaseSession ? { initialPurchaseSession: options.initialPurchaseSession } : {})}
    >
      <TicketPurchaseWidget
        {...(options.eventId ? { eventId: options.eventId } : {})}
        {...(options.occurrenceId ? { occurrenceId: options.occurrenceId } : {})}
        {...(options.occurrence ? { occurrence: options.occurrence } : {})}
        {...(options.mapHeight === undefined ? {} : { mapHeight: options.mapHeight })}
        {...(options.className ? { className: options.className } : {})}
        {...(options.children === undefined ? {} : { children: options.children })}
      />
    </TicketPurchaseProvider>,
  );
  return {
    unmount() {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  };
}

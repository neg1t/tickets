import { createRoot, type Root } from 'react-dom/client';
import {
  TicketPurchaseProvider,
  type TicketPurchaseProviderProps,
} from './lib/TicketPurchaseProvider.js';
import {
  TicketPurchaseWidget,
  type TicketPurchaseWidgetProps,
} from './lib/TicketPurchaseWidget.js';

export type TicketPurchaseDomOptions = Omit<
  TicketPurchaseProviderProps,
  'children'
> & TicketPurchaseWidgetProps;

export type TicketPurchaseDomMount = Readonly<{
  update: (options: TicketPurchaseDomOptions) => void;
  unmount: () => void;
}>;

/** Mounts an isolated widget instance into an existing host-owned DOM element. */
export function mountTicketPurchaseWidget(
  container: Element | DocumentFragment,
  initialOptions: TicketPurchaseDomOptions,
): TicketPurchaseDomMount {
  const root: Root = createRoot(container);
  const render = (options: TicketPurchaseDomOptions) => {
    const {
      dataSource,
      instanceId,
      initialStep,
      hostActions,
      theme,
      locale,
      occurrence,
      loading,
      error,
      className,
      headerContent,
      children,
    } = options;
    root.render(
      <TicketPurchaseProvider
        {...(dataSource ? { dataSource } : {})}
        {...(instanceId ? { instanceId } : {})}
        {...(initialStep ? { initialStep } : {})}
        {...(hostActions ? { hostActions } : {})}
        {...(theme ? { theme } : {})}
        {...(locale ? { locale } : {})}
      >
        <TicketPurchaseWidget
          {...(occurrence ? { occurrence } : {})}
          {...(loading === undefined ? {} : { loading })}
          {...(error === undefined ? {} : { error })}
          {...(className ? { className } : {})}
          {...(headerContent ? { headerContent } : {})}
        >
          {children}
        </TicketPurchaseWidget>
      </TicketPurchaseProvider>,
    );
  };
  render(initialOptions);
  return {
    update: render,
    unmount: () => root.unmount(),
  };
}


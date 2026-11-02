import { useSyncExternalStore } from 'react';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';

/** Subscribe to one widget's purchase state and expose its controller actions. */
export function useTicketPurchaseController() {
  const { controller } = useTicketPurchase();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, snapshot } as const;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  requirePurchaseDataSource,
  type PurchaseDataSource,
} from './model/purchase.types.js';
import type { BuyerContact, BuyerOrder, BuyerPaymentAttempt } from '@hall-platform/api-contracts';
import { createPurchaseController, type PurchaseController } from './model/createPurchaseController.js';
import type { PurchaseSession } from './model/purchase.types.js';

export type PurchaseStep = 'selection' | 'contacts' | 'payment' | 'success';

export type TicketPurchaseHostActions = Readonly<{
  onBack?: () => void;
  onDetails?: () => void;
  onHistory?: () => void;
  onTickets?: (ticketIds?: readonly string[]) => void | Promise<void>;
  onPaymentRequested?: (attempt: BuyerPaymentAttempt) => void | Promise<void>;
  onOrderConfirmed?: (order: BuyerOrder) => void | Promise<void>;
  onSessionCreated?: (session: PurchaseSession) => void;
}>;

export type TicketPurchaseTheme = Readonly<{
  accent: string;
  ink: string;
  surface: string;
  muted: string;
  border: string;
  background: string;
  fontFamily: string;
  radius: string;
}>;

const defaultTheme: TicketPurchaseTheme = {
  accent: '#bc2d9b',
  ink: '#323544',
  surface: '#ffffff',
  muted: '#717278',
  border: '#eeeeee',
  background: '#f5f5f5',
  fontFamily: 'Manrope, system-ui, sans-serif',
  radius: '12px',
};
const emptyContactPrefill: Partial<BuyerContact> = {};

export type TicketPurchaseProviderProps = PropsWithChildren<{
  readonly dataSource?: PurchaseDataSource;
  readonly instanceId?: string;
  readonly initialStep?: PurchaseStep;
  readonly hostActions?: TicketPurchaseHostActions;
  readonly theme?: Partial<TicketPurchaseTheme>;
  readonly locale?: string;
  readonly contactPrefill?: Partial<BuyerContact>;
  readonly hostBootstrapCredential?: string;
  readonly initialPurchaseSession?: Readonly<{ eventId: string; occurrenceId: string; purchaseSessionId: string }>;
}>;

export type TicketPurchaseContextValue = Readonly<{
  dataSource: PurchaseDataSource;
  controller: PurchaseController;
  instanceId: string;
  step: PurchaseStep;
  setStep: (step: PurchaseStep) => void;
  hostActions: TicketPurchaseHostActions;
  theme: TicketPurchaseTheme;
  locale: string;
  contactPrefill: Partial<BuyerContact>;
  requestBack: () => Promise<void>;
  canGoBack: boolean;
  registerDialogCloseHandler: (handler: () => void) => () => void;
}>;

const TicketPurchaseContext = createContext<TicketPurchaseContextValue | null>(
  null,
);

export function TicketPurchaseProvider({
  children,
  dataSource,
  instanceId,
  initialStep = 'selection',
  hostActions = {},
  theme,
  locale = 'ru-RU',
  contactPrefill = emptyContactPrefill,
  hostBootstrapCredential,
  initialPurchaseSession,
}: TicketPurchaseProviderProps) {
  const generatedId = useId().replace(/:/g, '');
  const [step, setStep] = useState<PurchaseStep>(initialStep);
  const configuredDataSource = requirePurchaseDataSource(dataSource);
  const controller = useMemo(
    () => createPurchaseController(configuredDataSource, {
      ...(hostBootstrapCredential ? { hostBootstrapCredential } : {}),
      ...(initialPurchaseSession ? { initialSession: initialPurchaseSession } : {}),
      ...(hostActions.onSessionCreated ? { onSessionCreated: hostActions.onSessionCreated } : {}),
    }),
    [configuredDataSource, hostActions.onSessionCreated, hostBootstrapCredential, initialPurchaseSession],
  );
  const pendingDisposals = useRef(new WeakMap<PurchaseController, ReturnType<typeof setTimeout>>());
  const dialogCloseHandlers = useRef(new Map<number, () => void>());
  const nextDialogHandlerId = useRef(0);
  const [openDialogCount, setOpenDialogCount] = useState(0);
  const registerDialogCloseHandler = useCallback((handler: () => void) => {
    const id = ++nextDialogHandlerId.current;
    dialogCloseHandlers.current.set(id, handler);
    setOpenDialogCount(dialogCloseHandlers.current.size);
    return () => {
      dialogCloseHandlers.current.delete(id);
      setOpenDialogCount(dialogCloseHandlers.current.size);
    };
  }, []);
  const requestBack = useCallback(async () => {
    const activeDialog = [...dialogCloseHandlers.current.values()].at(-1);
    if (activeDialog) {
      activeDialog();
      return;
    }
    if (step === 'payment') {
      setStep('contacts');
      return;
    }
    if (step === 'contacts') {
      const released = await controller.releaseHoldForSelection();
      if (released) setStep('selection');
      return;
    }
    hostActions.onBack?.();
  }, [controller, hostActions, step]);
  const resolvedTheme = useMemo(
    () => ({ ...defaultTheme, ...theme }),
    [theme],
  );
  const value = useMemo<TicketPurchaseContextValue>(
    () => ({
      dataSource: configuredDataSource,
      controller,
      instanceId: instanceId || `ticket-purchase-${generatedId}`,
      step,
      setStep,
      hostActions,
      theme: resolvedTheme,
      locale,
      contactPrefill,
      requestBack,
      canGoBack: openDialogCount > 0 || step !== 'selection',
      registerDialogCloseHandler,
    }),
    [
      configuredDataSource,
      controller,
      generatedId,
      hostActions,
      instanceId,
      locale,
      contactPrefill,
      openDialogCount,
      requestBack,
      registerDialogCloseHandler,
      resolvedTheme,
      step,
    ],
  );

  useEffect(() => {
    const timers = pendingDisposals.current;
    const pending = timers.get(controller);
    if (pending !== undefined) {
      clearTimeout(pending);
      timers.delete(controller);
    }
    return () => {
      const timer = setTimeout(() => {
        if (timers.get(controller) !== timer) return;
        timers.delete(controller);
        controller.dispose();
      }, 0);
      timers.set(controller, timer);
    };
  }, [controller]);

  return (
    <TicketPurchaseContext.Provider value={value}>
      {children}
    </TicketPurchaseContext.Provider>
  );
}

export function useTicketPurchase(): TicketPurchaseContextValue {
  const context = useContext(TicketPurchaseContext);
  if (!context) {
    throw new Error('Ticket purchase components must be inside TicketPurchaseProvider');
  }
  return context;
}


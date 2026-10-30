import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  requirePurchaseDataSource,
  type PurchaseDataSource,
} from './model/purchase.types.js';

export type PurchaseStep = 'selection' | 'contacts' | 'payment' | 'success';

export type TicketPurchaseHostActions = Readonly<{
  onBack?: () => void;
  onDetails?: () => void;
  onHistory?: () => void;
  onTickets?: () => void;
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

export type TicketPurchaseProviderProps = PropsWithChildren<{
  readonly dataSource?: PurchaseDataSource;
  readonly instanceId?: string;
  readonly initialStep?: PurchaseStep;
  readonly hostActions?: TicketPurchaseHostActions;
  readonly theme?: Partial<TicketPurchaseTheme>;
  readonly locale?: string;
}>;

export type TicketPurchaseContextValue = Readonly<{
  dataSource: PurchaseDataSource;
  instanceId: string;
  step: PurchaseStep;
  setStep: (step: PurchaseStep) => void;
  hostActions: TicketPurchaseHostActions;
  theme: TicketPurchaseTheme;
  locale: string;
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
}: TicketPurchaseProviderProps) {
  const generatedId = useId().replace(/:/g, '');
  const [step, setStep] = useState<PurchaseStep>(initialStep);
  const configuredDataSource = requirePurchaseDataSource(dataSource);
  const resolvedTheme = useMemo(
    () => ({ ...defaultTheme, ...theme }),
    [theme],
  );
  const value = useMemo<TicketPurchaseContextValue>(
    () => ({
      dataSource: configuredDataSource,
      instanceId: instanceId || `ticket-purchase-${generatedId}`,
      step,
      setStep,
      hostActions,
      theme: resolvedTheme,
      locale,
    }),
    [
      configuredDataSource,
      generatedId,
      hostActions,
      instanceId,
      locale,
      resolvedTheme,
      step,
    ],
  );

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


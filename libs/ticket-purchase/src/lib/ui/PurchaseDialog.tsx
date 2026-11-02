import { useEffect, useRef, type ReactNode } from 'react';
import { Dialog } from '@hall-platform/ui';
import { useTicketPurchase } from '../TicketPurchaseProvider.js';

export type PurchaseDialogProps = Readonly<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  className?: string;
}>;

/** A purchase dialog that lets the WebView back action dismiss the topmost open dialog first. */
export function PurchaseDialog(props: PurchaseDialogProps) {
  const { registerDialogCloseHandler } = useTicketPurchase();
  const onCloseRef = useRef(props.onClose);

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    if (!props.open) return;
    return registerDialogCloseHandler(() => onCloseRef.current());
  }, [props.open, registerDialogCloseHandler]);

  return <Dialog {...props} />;
}

import { Button } from '@hall-platform/ui';
import { PurchaseDialog } from './PurchaseDialog.js';

export type HoldExpiredDialogProps = Readonly<{
  open: boolean;
  locale: string;
  busy?: boolean;
  error?: string | null;
  onRefresh: () => void;
}>;

export function HoldExpiredDialog({ open, locale, busy = false, error, onRefresh }: HoldExpiredDialogProps) {
  const english = locale.toLowerCase().startsWith('en');
  return (
    <PurchaseDialog
      open={open}
      title={english ? 'Reservation expired' : 'Время резерва истекло'}
      closeLabel={english ? 'Refresh tickets' : 'Обновить билеты'}
      onClose={onRefresh}
    >
      <p>{english
        ? 'Ticket availability must be refreshed before you can continue. Your contact details remain in this form and are not added to the address bar.'
        : 'Перед продолжением нужно обновить наличие билетов. Контактные данные остаются в этой форме и не передаются в адресной строке.'}</p>
      {error ? <p className="tp-contact-form__error" role="alert">{error}</p> : null}
      <div className="tp-dialog-actions">
        <Button tone="primary" disabled={busy} onClick={onRefresh}>
          {busy
            ? english ? 'Refreshing…' : 'Обновляем…'
            : english ? 'Refresh tickets' : 'Обновить билеты'}
        </Button>
      </div>
    </PurchaseDialog>
  );
}

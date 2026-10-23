import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Tone = 'primary' | 'secondary' | 'quiet' | 'danger';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: 'sm' | 'md' };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ tone = 'secondary', size = 'md', className = '', type = 'button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} className={`hall-ui hall-button hall-button--${tone} hall-button--${size} ${className}`} />;
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { 'aria-label': string }>(function IconButton({ className = '', ...props }, ref) {
  return <Button {...props} ref={ref} className={`hall-icon-button ${className}`} />;
});

export function Field({ label, error, hint, id, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  return <div className={`hall-ui hall-field ${className}`}><label htmlFor={inputId}>{label}</label><input {...props} id={inputId} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? messageId : undefined} />{(error || hint) && <small id={messageId} className={error ? 'hall-field__error' : 'hall-field__hint'}>{error || hint}</small>}</div>;
}

export function Select({ label, error, hint, id, children, className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  return <div className={`hall-ui hall-field ${className}`}><label htmlFor={selectId}>{label}</label><select {...props} id={selectId} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? messageId : undefined}>{children}</select>{(error || hint) && <small id={messageId} className={error ? 'hall-field__error' : 'hall-field__hint'}>{error || hint}</small>}</div>;
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const id = useId();
  return <span className="hall-ui hall-tooltip-anchor" aria-describedby={id} tabIndex={0}>{children}<span id={id} role="tooltip" className="hall-tooltip">{content}</span></span>;
}

type OverlayProps = { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string; closeLabel?: string };

function Overlay({ open, title, onClose, children, className = '', closeLabel = 'Close', drawer = false }: OverlayProps & { drawer?: boolean }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    (panel?.querySelector<HTMLElement>(selector) ?? panel)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(selector));
      if (!items.length) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previousFocus.current?.focus(); };
  }, [open]);
  if (!open) return null;
  return <div className="hall-ui hall-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`hall-panel ${drawer ? 'hall-panel--drawer' : ''} ${className}`}><header className="hall-panel__header"><h2 id={titleId}>{title}</h2><IconButton aria-label={closeLabel} tone="quiet" onClick={onClose}>×</IconButton></header><div className="hall-panel__body">{children}</div></div></div>;
}

export function Dialog(props: OverlayProps) { return <Overlay {...props} />; }
export function Drawer(props: OverlayProps) { return <Overlay {...props} drawer />; }

export function Menu({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      event.preventDefault();
    };
    const handlePointer = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node) && event.target !== triggerRef.current) setOpen(false); };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handlePointer);
    return () => { document.removeEventListener('keydown', handleKey); document.removeEventListener('mousedown', handlePointer); };
  }, [open]);
  return <div className={`hall-ui hall-menu ${className}`}><Button ref={triggerRef} aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(true); } }}>{label}</Button>{open && <div ref={menuRef} id={id} role="menu" className="hall-menu__list" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>{children}</div>}</div>;
}

export function Toast({ children, tone = 'info', onDismiss, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'success' | 'error'; onDismiss?: () => void }) {
  return <div {...props} className={`hall-ui hall-toast hall-toast--${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>{children}{onDismiss && <IconButton aria-label="Dismiss notification" tone="quiet" onClick={onDismiss}>×</IconButton>}</div>;
}

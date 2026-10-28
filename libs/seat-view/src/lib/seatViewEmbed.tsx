import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SeatView, type SeatViewData, type SeatViewProps } from './SeatView.js';

export type SeatViewEmbedCheckout = (
  data: SeatViewData,
  signal: AbortSignal,
) => void | Promise<void>;

export type SeatViewEmbedOptions = Omit<
  SeatViewProps,
  'onSelectionChange' | 'onBuyClick'
> & {
  /** The host owns selection and feeds changes back through update(). */
  readonly onSelectionChange?: SeatViewProps['onSelectionChange'];
  /** Called when the buyer submits the current selection. */
  readonly onCheckout?: SeatViewEmbedCheckout;
  readonly theme?: 'light' | 'dark';
  readonly onResize?: (
    size: Readonly<{ width: number; height: number }>,
  ) => void;
};

export type SeatViewEmbed = Readonly<{
  update: (options: SeatViewEmbedOptions) => void;
  dispose: () => void;
}>;

function EmbedRoot({ options }: { readonly options: SeatViewEmbedOptions }) {
  const checkoutController = useRef<AbortController | null>(null);
  const contextKey = `${options.occurrenceId}:${options.layout.snapshot.id}`;

  useEffect(
    () => () => {
      checkoutController.current?.abort();
      checkoutController.current = null;
    },
    [contextKey],
  );

  async function handleCheckout(data: SeatViewData) {
    const controller = new AbortController();
    checkoutController.current?.abort();
    checkoutController.current = controller;
    try {
      await options.onCheckout?.(data, controller.signal);
    } finally {
      if (checkoutController.current === controller) {
        checkoutController.current = null;
      }
    }
  }

  return (
    <div
      className="seat-view-embed"
      data-theme={options.theme ?? 'light'}
      data-locale={options.locale ?? 'ru-RU'}
    >
      <SeatView
        {...options}
        onSelectionChange={options.onSelectionChange ?? (() => undefined)}
        onBuyClick={handleCheckout}
      />
    </div>
  );
}

/**
 * Mounts a buyer seat picker into a dedicated host element. The host owns the
 * document, availability, prices, and selected tickets and can replace them
 * with update(). This browser-only API does not create an iframe or store data.
 */
export function createSeatViewEmbed(
  element: HTMLElement,
  initialOptions: SeatViewEmbedOptions,
): SeatViewEmbed {
  let options = initialOptions;
  let disposed = false;
  const root: Root = createRoot(element);
  const render = () => root.render(<EmbedRoot options={options} />);
  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          const entry = entries.find(
            (candidate) => candidate.target === element,
          );
          if (!entry) return;
          const size = {
            width: Math.round(entry.contentRect.width),
            height: Math.round(entry.contentRect.height),
          };
          element.style.setProperty(
            '--seat-view-embed-width',
            `${size.width}px`,
          );
          element.style.setProperty(
            '--seat-view-embed-height',
            `${size.height}px`,
          );
          options.onResize?.(size);
        });

  resizeObserver?.observe(element);
  render();

  return {
    update(nextOptions) {
      if (disposed) throw new Error('Seat view embed has been disposed');
      options = nextOptions;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      element.style.removeProperty('--seat-view-embed-width');
      element.style.removeProperty('--seat-view-embed-height');
      root.unmount();
    },
  };
}

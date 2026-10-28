import type { PricingCatalog } from '@hall-platform/domain';
import { formatPricingMoney } from '@hall-platform/domain';
import type { PricingLabels } from './pricingLabels.js';

export function PricingSegmentList(props: {
  readonly catalog: PricingCatalog;
  readonly locale: string;
  readonly labels: PricingLabels;
  readonly selectedSegmentId: string;
  readonly disabled: boolean;
  readonly onSelect: (segmentId: string) => void;
}) {
  const active = props.catalog.items.filter(({ status }) => status === 'active');
  return (
    <section className="pricing-editor__panel" aria-labelledby="pricing-segments-heading">
      <h2 id="pricing-segments-heading">{props.labels.segments}</h2>
      {active.length === 0 ? (
        <p className="pricing-editor__muted">{props.labels.emptyCatalog}</p>
      ) : (
        <div className="pricing-editor__segments" role="radiogroup" aria-label={props.labels.segments}>
          {active.map((segment) => (
            <button
              key={segment.id}
              type="button"
              role="radio"
              aria-checked={props.selectedSegmentId === segment.id}
              disabled={props.disabled}
              onClick={() => props.onSelect(segment.id)}
              className="pricing-editor__segment"
            >
              <span
                aria-hidden="true"
                className="pricing-editor__swatch"
                style={{ backgroundColor: segment.color }}
              />
              <span className="pricing-editor__segment-copy">
                <strong>{segment.name}</strong>
                <span>{formatPricingMoney(segment.price, props.locale)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

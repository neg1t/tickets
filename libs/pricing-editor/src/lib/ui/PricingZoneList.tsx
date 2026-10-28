import type { LayoutSnapshot } from '@hall-platform/domain';
import type { PricingZoneSummary } from '../model/pricingDiagnostics.js';
import type { PricingLabels } from './pricingLabels.js';

function statusText(status: PricingZoneSummary['status'], labels: PricingLabels): string {
  switch (status) {
    case 'uniform':
    case 'assigned':
      return labels.assigned;
    case 'mixed':
      return labels.mixed;
    case 'partially_unassigned':
      return labels.partiallyAssigned;
    case 'unassigned':
      return labels.unassigned;
    case 'invalid':
      return labels.invalid;
    case 'empty':
      return labels.unassigned;
  }
}

export function PricingZoneList(props: {
  readonly snapshot: LayoutSnapshot;
  readonly summaries: readonly PricingZoneSummary[];
  readonly labels: PricingLabels;
  readonly selectedZoneId?: string;
  readonly onSelect: (zoneId: string) => void;
}) {
  if (props.snapshot.zones.length === 0) {
    return <p className="pricing-editor__muted">{props.labels.noZones}</p>;
  }
  const summaryByZone = new Map(props.summaries.map((summary) => [summary.zoneId, summary]));
  return (
    <ul className="pricing-editor__zone-list" aria-label={props.labels.zones}>
      {props.snapshot.zones.map((zone) => {
        const summary = summaryByZone.get(zone.id);
        if (!summary) return null;
        const selected = props.selectedZoneId === zone.id;
        return (
          <li key={zone.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => props.onSelect(zone.id)}
              className={`pricing-editor__zone pricing-editor__zone--${summary.status}${selected ? ' is-selected' : ''}`}
            >
              <span className="pricing-editor__zone-copy">
                <strong>{zone.name}</strong>
                <span>{zone.kind === 'ga' ? props.labels.gaCount(summary.assignedCount) : props.labels.seatsCount(summary.seatCount)}</span>
              </span>
              <span className="pricing-editor__zone-status">{statusText(summary.status, props.labels)}</span>
              {summary.status === 'mixed' && <span className="pricing-editor__mixed-mark" aria-label={props.labels.mixed}>◐</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

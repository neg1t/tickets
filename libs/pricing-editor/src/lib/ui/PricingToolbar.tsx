import type { PricingLabels } from './pricingLabels.js';

export function PricingToolbar(props: {
  readonly labels: PricingLabels;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  return (
    <div className="pricing-editor__toolbar">
      <div className="pricing-editor__history">
        <button type="button" disabled={!props.canUndo} onClick={props.onUndo}>
          {props.labels.undo}
        </button>
        <button type="button" disabled={!props.canRedo} onClick={props.onRedo}>
          {props.labels.redo}
        </button>
      </div>
    </div>
  );
}

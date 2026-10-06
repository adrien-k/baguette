import { describeCursorModelPricing } from '@baguette/shared/cursor-model-pricing.js';
import Tooltip from './Tooltip.jsx';
import { usageModelLabel } from '../utils/usageSeries.js';

function PricingTooltipContent({ pricing }) {
  return (
    <div className="space-y-1">
      <div className="text-faint">{pricing.header}</div>
      <dl className="space-y-0.5">
        {pricing.rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt>{row.label}</dt>
            <dd className="tabular-nums text-secondary">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Model name on the Usage page; shows list prices on hover when known. */
export default function UsageModelLabel({ model, className = '', title }) {
  const label = usageModelLabel(model);
  const pricing = model ? describeCursorModelPricing(model) : null;
  const fallbackTitle = title ?? (model || undefined);

  const inner = (
    <span className={className} title={pricing ? undefined : fallbackTitle}>
      {label}
    </span>
  );

  if (!pricing) return inner;

  return (
    <Tooltip content={<PricingTooltipContent pricing={pricing} />} wrap placement="top">
      {inner}
    </Tooltip>
  );
}

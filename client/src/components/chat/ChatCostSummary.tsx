import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  formatUsd,
  KIND_LABELS,
  listSessionCostLines,
  usageModelLabel,
} from '../../utils/usageSeries.js';

/** Collapsible session cost at the bottom of the chat transcript when the agent is idle. */
export default function ChatCostSummary({
  usage,
  loading = false,
}: {
  usage?: {
    breakdown?: { kind?: string; model?: string; cost_usd?: number | string }[];
    totals?: { cost_usd?: number | null } | null;
  } | null;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = listSessionCostLines(usage?.breakdown);
  const totalCost =
    Number(usage?.totals?.cost_usd ?? 0) || lines.reduce((s, r) => s + r.cost_usd, 0);

  if (loading || (lines.length === 0 && totalCost <= 0)) return null;

  return (
    <div className="pb-2 text-[11px] leading-snug text-faint">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left hover:text-fg-muted transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden />
        )}
        <span className="shrink-0">Session cost:</span>
        <span className="tabular-nums font-medium text-secondary">{formatUsd(totalCost)}</span>
      </button>
      {expanded && lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-5">
          {lines.map((row) => (
            <li
              key={`${row.kind}-${row.model}`}
              className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-fg-muted"
            >
              <span className="shrink-0">
                {(KIND_LABELS as Record<string, string>)[row.kind] ?? row.kind}
              </span>
              <span className="text-line" aria-hidden>
                ·
              </span>
              <span className="min-w-0 truncate max-w-[14rem]" title={row.model}>
                {usageModelLabel(row.model)}
              </span>
              <span className="tabular-nums text-secondary">{formatUsd(row.cost_usd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

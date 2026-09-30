/**
 * Chart-data helpers for the Usage page: they pivot the flat
 * (day, repo, sdk, kind, model) rows from `/api/usage/breakdown` into stacked series
 * along whichever dimension is being shown, and into a coarser table.
 *
 * The graph defaults to tokens (reported by both SDKs). It can also plot `cost_usd`
 * when the user toggles to spend; Cursor rows get estimated cost from the pricing table.
 */
import { repoDisplayName } from './repoDisplayName.js';

/** The plotted metric. Rows written before the token columns existed count as 0. */
export function metricOf(row, metric = 'tokens') {
  if (metric === 'cost') return Number(row.cost_usd ?? 0);
  return row.total_tokens ?? 0;
}

export function formatMetric(value, metric = 'tokens') {
  return metric === 'cost' ? formatUsd(value) : formatTokens(value);
}

/** Compact token counts for axis and legend labels: 910, 12.3k, 4.1M. */
export function formatTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/** Compact USD for the rare rows that actually carry a cost (Claude). */
export function formatUsd(n) {
  const value = Number(n) || 0;
  if (value <= 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(0)}`;
}

export const USAGE_DAY_OPTIONS = [7, 30, 90];
export const DEFAULT_USAGE_DAYS = 30;

export function parseUsageDays(value) {
  const n = Number(value);
  return USAGE_DAY_OPTIONS.includes(n) ? n : DEFAULT_USAGE_DAYS;
}

/** Reviewer vs session-chat. Null / `turn` / anything else counts as session. */
export function usageKindOf(row) {
  return row?.kind === 'review' ? 'review' : 'session';
}

export const KIND_LABELS = { session: 'Session', review: 'Review' };
export const SDK_LABELS = { claude: 'Claude', cursor: 'Cursor' };

export function usageRepoLabel(fullName) {
  if (!fullName || fullName === '__global__') return 'Global';
  return repoDisplayName(fullName);
}

export function usageRepoTitle(fullName) {
  if (!fullName || fullName === '__global__') return 'Global sessions';
  return fullName;
}

/** Usage rows store a model id (or nothing, on older turns). */
export function usageModelLabel(model) {
  return model || 'Unknown';
}

const EMPTY_USAGE_METRICS = {
  total_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cost_usd: 0,
};

function addUsageMetrics(acc, row) {
  acc.total_tokens += metricOf(row);
  acc.input_tokens += Number(row.input_tokens ?? 0);
  acc.output_tokens += Number(row.output_tokens ?? 0);
  acc.cache_read_tokens += Number(row.cache_read_tokens ?? 0);
  acc.cache_write_tokens += Number(row.cache_write_tokens ?? 0);
  acc.cost_usd += Number(row.cost_usd ?? 0);
  return acc;
}

// Categorical slots, assigned in fixed order and never cycled: the 9th series and
// beyond fold into "Other". Validated for the dark chart surface (zinc-900) against
// the lightness band, chroma floor, CVD separation and contrast.
export const SERIES_COLORS = [
  'bg-amber-600',
  'bg-sky-600',
  'bg-emerald-600',
  'bg-violet-500',
  'bg-rose-500',
  'bg-fuchsia-500',
  'bg-lime-600',
  'bg-cyan-600',
];
const OTHER_COLOR = 'bg-track';
export const OTHER_KEY = '__other__';

const SDK_COLORS = { claude: SERIES_COLORS[0], cursor: SERIES_COLORS[1] };
const KIND_COLORS = { session: SERIES_COLORS[0], review: SERIES_COLORS[2] };

/** The last `count` UTC days, oldest first — `date(created_at)` on the server is UTC too. */
export function recentDays(count = DEFAULT_USAGE_DAYS) {
  const days = [];
  const n = Math.max(1, Number(count) || DEFAULT_USAGE_DAYS);
  for (let i = n - 1; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return days;
}

export function sumBy(rows, pick, metric = 'tokens') {
  const totals = new Map();
  for (const row of rows) {
    const key = pick(row);
    totals.set(key, (totals.get(key) ?? 0) + metricOf(row, metric));
  }
  return totals;
}

/**
 * Turn the flat (day, repo, sdk, kind) rows into stacked series along one dimension.
 * Colour follows the repository itself (alphabetical slot) rather than its rank, so
 * re-sorting the legend by usage never repaints the bars.
 */
function rankedPaletteKeys(rows, pick, metric) {
  const ranked = [...sumBy(rows, pick, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  const named = ranked.slice(0, SERIES_COLORS.length);
  const colors = new Map([...named].sort().map((key, i) => [key, SERIES_COLORS[i]]));
  return { colors, otherCount: ranked.length - named.length };
}

export function buildSeries(rows, dimension, metric = 'tokens') {
  const { colors: repoColors, otherCount: otherRepoCount } = rankedPaletteKeys(
    rows,
    (r) => r.repo_full_name,
    metric
  );
  const { colors: modelColors, otherCount: otherModelCount } = rankedPaletteKeys(
    rows,
    (r) => r.model || '',
    metric
  );

  const keyOf = (r) => {
    if (dimension === 'sdk') return r.agent_sdk;
    if (dimension === 'kind') return usageKindOf(r);
    if (dimension === 'model') {
      const model = r.model || '';
      return modelColors.has(model) ? model : OTHER_KEY;
    }
    return repoColors.has(r.repo_full_name) ? r.repo_full_name : OTHER_KEY;
  };

  const colorOf = (key) => {
    if (key === OTHER_KEY) return OTHER_COLOR;
    if (dimension === 'sdk') return SDK_COLORS[key] ?? OTHER_COLOR;
    if (dimension === 'kind') return KIND_COLORS[key] ?? OTHER_COLOR;
    if (dimension === 'model') return modelColors.get(key) ?? OTHER_COLOR;
    return repoColors.get(key) ?? OTHER_COLOR;
  };

  const labelOf = (key) => {
    if (key === OTHER_KEY) {
      if (dimension === 'model') {
        const n = otherModelCount;
        return `Other (${n} ${n === 1 ? 'model' : 'models'})`;
      }
      return `Other (${otherRepoCount} ${otherRepoCount === 1 ? 'repo' : 'repos'})`;
    }
    if (dimension === 'sdk') return SDK_LABELS[key] ?? key;
    if (dimension === 'kind') return KIND_LABELS[key] ?? key;
    if (dimension === 'model') return usageModelLabel(key);
    return usageRepoLabel(key);
  };

  // The label is shortened for display (`repoDisplayName` drops the owner), so carry the
  // full name along for the tooltip that a truncated legend entry needs.
  const titleOf = (key) => {
    if (dimension === 'repo' && key !== OTHER_KEY) return usageRepoTitle(key);
    if (dimension === 'model' && key !== OTHER_KEY) return key || usageModelLabel(key);
    return labelOf(key);
  };

  const series = [...sumBy(rows, keyOf, metric).entries()]
    // Biggest first, so the tallest block sits at the bottom of every column; "Other" last.
    .sort((a, b) => (a[0] === OTHER_KEY) - (b[0] === OTHER_KEY) || b[1] - a[1])
    .map(([key, total]) => ({
      key,
      total,
      color: colorOf(key),
      label: labelOf(key),
      title: titleOf(key),
    }));

  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, new Map());
    const day = byDay.get(row.day);
    day.set(keyOf(row), (day.get(keyOf(row)) ?? 0) + metricOf(row, metric));
  }

  return { series, byDay };
}

/**
 * Collapse daily rows into one line per (repo, agent, kind) — or also per model
 * when `byModel` is on, so the table can split a repo across models.
 */
export function aggregateUsage(rows, { byModel = false } = {}) {
  const totals = new Map();
  for (const row of rows) {
    const kind = usageKindOf(row);
    const model = row.model || '';
    const key = byModel
      ? `${row.repo_full_name}\t${row.agent_sdk}\t${kind}\t${model}`
      : `${row.repo_full_name}\t${row.agent_sdk}\t${kind}`;
    const prev = totals.get(key) ?? {
      repo_full_name: row.repo_full_name,
      agent_sdk: row.agent_sdk,
      kind,
      ...(byModel ? { model } : {}),
      ...EMPTY_USAGE_METRICS,
    };
    addUsageMetrics(prev, row);
    totals.set(key, prev);
  }
  return [...totals.values()].sort(
    (a, b) => b.total_tokens - a.total_tokens || b.cost_usd - a.cost_usd
  );
}

export function sumUsageMetrics(rows) {
  return rows.reduce((acc, row) => addUsageMetrics(acc, row), { ...EMPTY_USAGE_METRICS });
}

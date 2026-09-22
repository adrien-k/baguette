/**
 * Chart-data helpers for the dashboard cost graph: they pivot the flat
 * (day, repo, sdk) rows from `/api/usage/breakdown` into stacked series along
 * whichever dimension is being shown.
 */
import { repoDisplayName } from './repoDisplayName.js';

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
const OTHER_COLOR = 'bg-zinc-600';
export const OTHER_KEY = '__other__';

const SDK_COLORS = { claude: SERIES_COLORS[0], cursor: SERIES_COLORS[1] };
const SDK_LABELS = { claude: 'Claude', cursor: 'Cursor' };

const GRAPH_DAYS = 30;

/** The last `GRAPH_DAYS` UTC days, oldest first — `date(created_at)` on the server is UTC too. */
export function recentDays() {
  const days = [];
  for (let i = GRAPH_DAYS - 1; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return days;
}

export function sumBy(rows, pick) {
  const totals = new Map();
  for (const row of rows) {
    const key = pick(row);
    totals.set(key, (totals.get(key) ?? 0) + row.cost_usd);
  }
  return totals;
}

/**
 * Turn the flat (day, repo, sdk) rows into stacked series along one dimension.
 * Colour follows the repository itself (alphabetical slot) rather than its rank, so
 * re-sorting the legend by spend never repaints the bars.
 */
export function buildSeries(rows, dimension) {
  const repoTotals = sumBy(rows, (r) => r.repo_full_name);
  const ranked = [...repoTotals.entries()].sort((a, b) => b[1] - a[1]).map(([repo]) => repo);
  const named = ranked.slice(0, SERIES_COLORS.length);
  const repoColors = new Map([...named].sort().map((repo, i) => [repo, SERIES_COLORS[i]]));
  const otherCount = ranked.length - named.length;

  const keyOf = (r) =>
    dimension === 'sdk'
      ? r.agent_sdk
      : repoColors.has(r.repo_full_name)
        ? r.repo_full_name
        : OTHER_KEY;

  const colorOf = (key) =>
    key === OTHER_KEY
      ? OTHER_COLOR
      : dimension === 'sdk'
        ? (SDK_COLORS[key] ?? OTHER_COLOR)
        : (repoColors.get(key) ?? OTHER_COLOR);

  const labelOf = (key) =>
    key === OTHER_KEY
      ? `Other (${otherCount} ${otherCount === 1 ? 'repo' : 'repos'})`
      : dimension === 'sdk'
        ? (SDK_LABELS[key] ?? key)
        : repoDisplayName(key);

  // The label is shortened for display (`repoDisplayName` drops the owner), so carry the
  // full name along for the tooltip that a truncated legend entry needs.
  const titleOf = (key) => (dimension === 'repo' && key !== OTHER_KEY ? key : labelOf(key));

  const series = [...sumBy(rows, keyOf).entries()]
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
    day.set(keyOf(row), (day.get(keyOf(row)) ?? 0) + row.cost_usd);
  }

  return { series, byDay };
}

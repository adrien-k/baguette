import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import { buildSeries, formatTokens, metricOf, recentDays, sumBy } from '../utils/usageSeries.js';

function DimensionToggle({ value, onChange }) {
  const option = (key, label) => (
    <button
      key={key}
      type="button"
      onClick={() => onChange(key)}
      aria-pressed={value === key}
      className={`px-1.5 py-0.5 rounded transition-colors ${
        value === key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 text-xs bg-zinc-800/80 rounded p-0.5">
      {option('repo', 'By repo')}
      {option('sdk', 'By agent')}
    </div>
  );
}

function usageBreakdownQuery({ repoFilter, agentSdkFilter }) {
  const params = new URLSearchParams();
  if (repoFilter) params.set('repo', repoFilter);
  if (agentSdkFilter) params.set('sdk', agentSdkFilter);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Stacked token chart for the last 30 days. Optional `repoFilter` and `agentSdkFilter`
 * narrow the `/api/usage/breakdown` query (Settings > Agent uses one graph per SDK).
 */
export default function UsageGraph({ repoFilter, agentSdkFilter, className = '' }) {
  const [rows, setRows] = useState(null);
  const [dimension, setDimension] = useState('repo');
  const [hoveredDay, setHoveredDay] = useState(null);

  useEffect(() => {
    const query = usageBreakdownQuery({ repoFilter, agentSdkFilter });
    let cancelled = false;
    setHoveredDay(null);
    apiFetch(`/api/usage/breakdown${query}`)
      .then((d) => !cancelled && setRows(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repoFilter, agentSdkFilter]);

  const data = rows ?? [];
  const total = data.reduce((sum, r) => sum + metricOf(r), 0);

  // A dimension with a single value can't be broken down — drop the toggle and show the
  // other one (picking one repo, for instance, leaves only the agent split worth seeing).
  const canSplitByRepo = sumBy(data, (r) => r.repo_full_name).size > 1;
  const canSplitBySdk = sumBy(data, (r) => r.agent_sdk).size > 1;
  const showToggle = canSplitByRepo && canSplitBySdk && !agentSdkFilter;
  const activeDimension = showToggle ? dimension : canSplitBySdk ? 'sdk' : 'repo';

  const { series, byDay } = buildSeries(data, activeDimension);
  const days = recentDays();
  const dayTotal = (day) => [...(byDay.get(day)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const maxDay = Math.max(0, ...days.map(dayTotal));

  // maxDay can be 0 while total isn't if every row falls just outside the 30 rendered
  // days (the server window ends mid-day) — there would be nothing to draw.
  if (total === 0 || maxDay === 0) return null;

  const hoveredSeries = hoveredDay
    ? series
        .map((s) => ({ ...s, tokens: byDay.get(hoveredDay)?.get(s.key) ?? 0 }))
        .filter((s) => s.tokens > 0)
    : [];

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-zinc-400">
          Tokens per day <span className="text-zinc-600 font-normal">(last 30d)</span>
        </span>
        <div className="flex items-center gap-3">
          {showToggle && <DimensionToggle value={dimension} onChange={setDimension} />}
          <span className="text-xs text-zinc-500">{formatTokens(total)} total</span>
        </div>
      </div>

      <div>
        <div className="flex items-stretch gap-px h-16" onMouseLeave={() => setHoveredDay(null)}>
          {days.map((day) => {
            const perSeries = byDay.get(day);
            const dayTokens = dayTotal(day);
            return (
              <div
                key={day}
                className={`flex-1 h-full flex flex-col-reverse gap-[2px] cursor-default ${
                  hoveredDay && hoveredDay !== day ? 'opacity-50' : ''
                }`}
                onMouseEnter={() => setHoveredDay(day)}
              >
                {series.map((s) => {
                  const tokens = perSeries?.get(s.key) ?? 0;
                  if (tokens <= 0) return null;
                  return (
                    <div
                      key={s.key}
                      className={`${s.color} rounded-sm`}
                      style={{ height: `${Math.max((tokens / maxDay) * 100, 3)}%` }}
                    />
                  );
                })}
                {dayTokens === 0 && (
                  <div className="bg-zinc-700/30 rounded-sm" style={{ height: '1px' }} />
                )}
              </div>
            );
          })}
        </div>
        <div className="h-4 mt-1 flex items-center gap-2 overflow-hidden">
          {hoveredDay && hoveredSeries.length > 0 && (
            <>
              <span className="text-xs text-zinc-400 shrink-0">{hoveredDay}</span>
              <span className="text-xs text-zinc-300 shrink-0">
                {formatTokens(dayTotal(hoveredDay))}
              </span>
              {hoveredSeries.slice(0, 3).map((s) => (
                <span key={s.key} className="flex items-center gap-1 min-w-0 shrink">
                  <span className={`w-2 h-2 rounded-sm shrink-0 ${s.color}`} />
                  <span className="text-xs text-zinc-500 truncate">{s.label}</span>
                  <span className="text-xs text-zinc-600 shrink-0">{formatTokens(s.tokens)}</span>
                </span>
              ))}
              {hoveredSeries.length > 3 && (
                <span className="text-xs text-zinc-600 shrink-0">
                  +{hoveredSeries.length - 3} more
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {series.length > 1 && (
        <div>
          <div className="flex h-2 rounded-full overflow-hidden gap-[2px] mb-2.5">
            {series.map((s) => (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${(s.total / total) * 100}%` }}
                title={`${s.title}: ${formatTokens(s.total)} tokens`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.color}`} />
                <span className="text-xs text-zinc-400 truncate max-w-48" title={s.title}>
                  {s.label}
                </span>
                <span className="text-xs text-zinc-600">{formatTokens(s.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

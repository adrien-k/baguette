import { useState } from 'react';
import { buildSeries, formatTokens, metricOf, recentDays, sumBy } from '../utils/usageSeries.js';

const DIMENSIONS = [
  { key: 'repo', label: 'By repo' },
  { key: 'sdk', label: 'By agent' },
  { key: 'kind', label: 'By activity' },
];

function DimensionToggle({ value, onChange, options }) {
  return (
    <div className="flex items-center gap-0.5 text-xs bg-zinc-800/80 rounded p-0.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={`px-1.5 py-0.5 rounded transition-colors ${
            value === opt.key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function axisLabel(day, days) {
  const d = new Date(`${day}T00:00:00Z`);
  if (days.length <= 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  }
  const i = days.indexOf(day);
  const step = days.length <= 30 ? 7 : 14;
  if (i === 0 || i === days.length - 1 || i % step === 0) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return '';
}

/**
 * Stacked daily token chart. `rows` come from `/api/usage/breakdown`. Click a day
 * to pin it (parent can filter the table); click again to clear.
 */
export default function UsageGraph({
  rows,
  dayCount = 30,
  dimension,
  onDimensionChange,
  selectedDay,
  onSelectedDayChange,
  className = '',
}) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const data = rows ?? [];
  const total = data.reduce((sum, r) => sum + metricOf(r), 0);

  const canSplitByRepo = sumBy(data, (r) => r.repo_full_name).size > 1;
  const canSplitBySdk = sumBy(data, (r) => r.agent_sdk).size > 1;
  const canSplitByKind = sumBy(data, (r) => (r.kind === 'review' ? 'review' : 'session')).size > 1;

  const dimensionOptions = DIMENSIONS.filter((d) => {
    if (d.key === 'repo') return canSplitByRepo;
    if (d.key === 'sdk') return canSplitBySdk;
    return canSplitByKind;
  });
  const showToggle = dimensionOptions.length > 1;
  const activeDimension = dimensionOptions.some((d) => d.key === dimension)
    ? dimension
    : (dimensionOptions[0]?.key ?? 'repo');

  const { series, byDay } = buildSeries(data, activeDimension);
  const days = recentDays(dayCount);
  const dayTotal = (day) => [...(byDay.get(day)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const maxDay = Math.max(0, ...days.map(dayTotal));

  if (total === 0 || maxDay === 0) return null;

  const inspectDay = hoveredDay ?? selectedDay ?? null;
  const hoveredSeries = inspectDay
    ? series
        .map((s) => ({ ...s, tokens: byDay.get(inspectDay)?.get(s.key) ?? 0 }))
        .filter((s) => s.tokens > 0)
    : [];

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-medium text-zinc-400">Tokens per day</span>
        <div className="flex items-center gap-3">
          {showToggle && (
            <DimensionToggle
              value={activeDimension}
              onChange={onDimensionChange}
              options={dimensionOptions}
            />
          )}
          <span className="text-xs text-zinc-500">{formatTokens(total)} in range</span>
        </div>
      </div>

      <div>
        <div className="flex items-stretch gap-px h-36" onMouseLeave={() => setHoveredDay(null)}>
          {days.map((day) => {
            const perSeries = byDay.get(day);
            const dayTokens = dayTotal(day);
            const isSelected = selectedDay === day;
            const dimmed = selectedDay && selectedDay !== day;
            return (
              <button
                key={day}
                type="button"
                className={`flex-1 h-full min-w-0 flex flex-col-reverse gap-[2px] cursor-pointer bg-transparent p-0 border-0 ${
                  dimmed ? 'opacity-35' : ''
                } ${isSelected ? 'ring-1 ring-amber-400/70 rounded-sm' : ''}`}
                aria-pressed={isSelected}
                aria-label={`${day}: ${formatTokens(dayTokens)} tokens`}
                onMouseEnter={() => setHoveredDay(day)}
                onClick={() => onSelectedDayChange?.(isSelected ? null : day)}
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
                  <div className="bg-zinc-700/30 rounded-sm w-full" style={{ height: '2px' }} />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex items-start gap-px h-4">
          {days.map((day) => (
            <span
              key={day}
              className="flex-1 min-w-0 text-[10px] leading-none text-zinc-600 text-center truncate"
            >
              {axisLabel(day, days)}
            </span>
          ))}
        </div>
        <div className="h-5 mt-1 flex items-center gap-2 overflow-hidden">
          {inspectDay && hoveredSeries.length > 0 && (
            <>
              <span className="text-xs text-zinc-400 shrink-0">{inspectDay}</span>
              <span className="text-xs text-zinc-300 shrink-0">
                {formatTokens(dayTotal(inspectDay))}
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
              {selectedDay && (
                <span className="text-xs text-zinc-600 shrink-0 ml-auto">Click again to clear</span>
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

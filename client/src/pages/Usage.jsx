import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Layers } from 'lucide-react';
import { apiFetch } from '../api.js';
import UsageGraph from '../components/UsageGraph.jsx';
import RepoDropdown, { repoDropdownRepoSections } from '../components/RepoDropdown.jsx';
import { chipOptionClassName } from '../components/LightChipDropdown.jsx';
import { useRepoContext, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import {
  KIND_LABELS,
  SDK_LABELS,
  USAGE_DAY_OPTIONS,
  aggregateUsage,
  formatTokens,
  formatUsd,
  metricOf,
  parseUsageDays,
  sumUsageMetrics,
  usageRepoLabel,
  usageRepoTitle,
} from '../utils/usageSeries.js';

function usageBreakdownQuery({ days, repo, sdk, kind }) {
  const params = new URLSearchParams();
  params.set('days', String(days));
  if (repo) params.set('repo', repo);
  if (sdk) params.set('sdk', sdk);
  if (kind) params.set('kind', kind);
  return `?${params}`;
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={chipOptionClassName(active)}
    >
      {children}
    </button>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-line bg-inset/50 px-4 py-3 min-w-0">
      <div className="text-xs text-faint">{label}</div>
      <div className="text-lg font-semibold text-fg tabular-nums mt-0.5 truncate">{value}</div>
      {hint ? <div className="text-xs text-faint mt-0.5 truncate">{hint}</div> : null}
    </div>
  );
}

export default function Usage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { repos } = useRepoContext();
  const days = parseUsageDays(searchParams.get('days'));
  const repo = searchParams.get('repo') || '';
  const sdk = searchParams.get('sdk') || '';
  const kind = searchParams.get('kind') || '';

  const [rows, setRows] = useState(null);
  const [dimension, setDimension] = useState('repo');
  const [selectedDay, setSelectedDay] = useState(null);

  const setFilter = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
    setSelectedDay(null);
  };

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    apiFetch(`/api/usage/breakdown${usageBreakdownQuery({ days, repo, sdk, kind })}`)
      .then((d) => !cancelled && setRows(d))
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [days, repo, sdk, kind]);

  const data = useMemo(() => rows ?? [], [rows]);
  const tableRows = useMemo(() => {
    const scoped = selectedDay ? data.filter((r) => r.day === selectedDay) : data;
    return aggregateUsage(scoped);
  }, [data, selectedDay]);
  const totals = useMemo(() => {
    const scoped = selectedDay ? data.filter((r) => r.day === selectedDay) : data;
    return sumUsageMetrics(scoped);
  }, [data, selectedDay]);
  const showCost = data.some((r) => Number(r.cost_usd) > 0);
  const loading = rows === null;

  const repoSections = useMemo(
    () => [
      {
        options: [
          { value: '', label: 'All repos', icon: <Layers className="w-3.5 h-3.5 shrink-0" /> },
          { value: GLOBAL_SCOPE, label: 'Global', icon: <Bot className="w-3.5 h-3.5 shrink-0" /> },
        ],
      },
      ...repoDropdownRepoSections(repos),
    ],
    [repos]
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-fg">Usage</h1>
          <p className="text-sm text-fg-muted mt-1 max-w-2xl">
            Token activity across your sessions. Click a day on the timeline to zoom the table.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {USAGE_DAY_OPTIONS.map((n) => (
            <FilterChip key={n} active={days === n} onClick={() => setFilter({ days: String(n) })}>
              {n}d
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RepoDropdown
          value={repo}
          onChange={(value) => setFilter({ repo: value })}
          sections={repoSections}
          ariaLabel="Filter by repository"
          placement="bottom-start"
        />
        <div className="flex items-center gap-1.5">
          <FilterChip active={!sdk} onClick={() => setFilter({ sdk: '' })}>
            All agents
          </FilterChip>
          <FilterChip active={sdk === 'claude'} onClick={() => setFilter({ sdk: 'claude' })}>
            Claude
          </FilterChip>
          <FilterChip active={sdk === 'cursor'} onClick={() => setFilter({ sdk: 'cursor' })}>
            Cursor
          </FilterChip>
        </div>
        <div className="flex items-center gap-1.5">
          <FilterChip active={!kind} onClick={() => setFilter({ kind: '' })}>
            All activity
          </FilterChip>
          <FilterChip active={kind === 'session'} onClick={() => setFilter({ kind: 'session' })}>
            Session
          </FilterChip>
          <FilterChip active={kind === 'review'} onClick={() => setFilter({ kind: 'review' })}>
            Review
          </FilterChip>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={selectedDay ? `Tokens · ${selectedDay}` : 'Tokens'}
          value={loading ? '…' : formatTokens(totals.total_tokens)}
          hint={
            totals.total_tokens
              ? `${formatTokens(totals.input_tokens)} in · ${formatTokens(totals.output_tokens)} out`
              : undefined
          }
        />
        <StatCard
          label="Cache reads"
          value={loading ? '…' : formatTokens(totals.cache_read_tokens)}
        />
        <StatCard
          label="Active days"
          value={
            loading
              ? '…'
              : String(new Set(data.filter((r) => metricOf(r) > 0).map((r) => r.day)).size)
          }
          hint={`of ${days}`}
        />
        <StatCard
          label="Reported cost"
          value={loading ? '…' : showCost ? formatUsd(totals.cost_usd) : '—'}
          hint={
            showCost
              ? 'Claude billed; Cursor estimated from pricing table'
              : 'No billed cost in this range'
          }
        />
      </div>

      <section className="rounded-xl border border-line bg-inset/50 p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-faint">Loading timeline…</p>
        ) : data.reduce((s, r) => s + metricOf(r), 0) === 0 ? (
          <p className="text-sm text-faint">No token usage in this range.</p>
        ) : (
          <UsageGraph
            rows={data}
            dayCount={days}
            dimension={dimension}
            onDimensionChange={setDimension}
            selectedDay={selectedDay}
            onSelectedDayChange={setSelectedDay}
          />
        )}
      </section>

      <section className="rounded-xl border border-line bg-inset/50 overflow-hidden">
        <div className="px-4 sm:px-6 py-3 border-b border-line flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-heading">
            By repository
            {selectedDay ? <span className="font-normal text-faint"> · {selectedDay}</span> : null}
          </h2>
          {selectedDay && (
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="text-xs text-fg-muted hover:text-heading"
            >
              Show all days
            </button>
          )}
        </div>
        {loading ? (
          <p className="px-4 sm:px-6 py-8 text-sm text-faint">Loading details…</p>
        ) : tableRows.length === 0 ? (
          <p className="px-4 sm:px-6 py-8 text-sm text-faint">Nothing to list for these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint border-b border-line">
                  <th className="font-medium px-4 sm:px-6 py-2">Repo</th>
                  <th className="font-medium px-3 py-2">Agent</th>
                  <th className="font-medium px-3 py-2">Activity</th>
                  <th className="font-medium px-3 py-2 w-full min-w-32">Tokens</th>
                  {showCost && <th className="font-medium px-4 sm:px-6 py-2 text-right">Cost</th>}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const share = totals.total_tokens
                    ? (row.total_tokens / totals.total_tokens) * 100
                    : 0;
                  return (
                    <tr
                      key={`${row.repo_full_name}:${row.agent_sdk}:${row.kind}`}
                      className="border-b border-line/80 last:border-0"
                    >
                      <td className="px-4 sm:px-6 py-2.5 text-heading">
                        <span title={usageRepoTitle(row.repo_full_name)}>
                          {usageRepoLabel(row.repo_full_name)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {SDK_LABELS[row.agent_sdk] ?? row.agent_sdk}
                      </td>
                      <td className="px-3 py-2.5 text-fg-muted">
                        {KIND_LABELS[row.kind] ?? row.kind}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className="text-heading tabular-nums w-12 shrink-0">
                            {formatTokens(row.total_tokens)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-control overflow-hidden min-w-16">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{ width: `${Math.max(share, share > 0 ? 2 : 0)}%` }}
                            />
                          </div>
                          <span className="text-xs text-faint tabular-nums w-10 text-right shrink-0">
                            {Math.round(share)}%
                          </span>
                        </div>
                      </td>
                      {showCost && (
                        <td className="px-4 sm:px-6 py-2.5 text-right text-fg-muted tabular-nums">
                          {row.cost_usd > 0 ? formatUsd(row.cost_usd) : '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

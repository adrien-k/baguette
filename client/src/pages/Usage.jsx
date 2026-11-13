import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import UsageGraph from '../components/UsageGraph.jsx';
import UsageModelLabel from '../components/UsageModelLabel.jsx';
import ActiveAgentsSection from '../components/ActiveAgentsSection.jsx';
import SearchableSelect from '../components/SearchableSelect/index.jsx';
import { usageService, usersService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { chipOptionClassName } from '../components/LightChipDropdown.jsx';
import { useRepoContext, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import { parseUsageAgentTypeFilter } from '@baguette/shared/usage-agent-type.js';
import { formatRepoLabel, duplicateRepoDisplayNames } from '../utils/repoDisplayName.js';
import {
  AGENT_TYPE_LABELS,
  USAGE_DAY_OPTIONS,
  aggregateUsage,
  formatTokens,
  formatUsd,
  metricOf,
  parseUsageDays,
  resolveUsageDimension,
  sumUsageMetrics,
  usageDimensionHeading,
  usageGroupLabel,
  usageGroupTitle,
} from '../utils/usageSeries.js';

const UNKNOWN_MODEL_FILTER = '__unknown__';

const AGENT_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'builder', label: AGENT_TYPE_LABELS.builder },
  { value: 'reviewer', label: AGENT_TYPE_LABELS.reviewer },
  { value: 'subagent', label: AGENT_TYPE_LABELS.subagent },
];

function usageFilterPayload({ days, repo, agentType, userId, model }) {
  const payload = { days: String(days) };
  if (repo) payload.repo = repo;
  if (agentType) payload.agent_type = agentType;
  if (userId) payload.user_id = String(userId);
  if (model) payload.model = model;
  return payload;
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

function FilterField({ label, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-1 min-w-[9rem] w-[12rem] ${className}`}>
      <span className="text-xs text-faint">{label}</span>
      {children}
    </div>
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
  const model = searchParams.get('model') || '';
  const userId = searchParams.get('user_id') || '';
  const agentType =
    parseUsageAgentTypeFilter({
      agent_type: searchParams.get('agent_type'),
      kind: searchParams.get('kind'),
    }) || '';

  const [rows, setRows] = useState(null);
  const [selectedUserLabel, setSelectedUserLabel] = useState(null);
  const [dimension, setDimension] = useState('repo');
  const [selectedDay, setSelectedDay] = useState(null);

  const setFilter = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (patch.agent_type !== undefined) next.delete('kind');
    setSearchParams(next, { replace: true });
    setSelectedDay(null);
  };

  const getUsageUserOptions = useCallback(
    async (query) => {
      try {
        const found = await usageService.usageUsers({
          days: String(days),
          q: query,
        });
        return Array.isArray(found) ? found : [];
      } catch (err) {
        toastError('Failed to load users', err);
        return [];
      }
    },
    [days]
  );

  const getUsageModelOptions = useCallback(
    async (query) => {
      try {
        const found = await usageService.usageModels({
          days: String(days),
          q: query,
          ...(userId ? { user_id: String(userId) } : {}),
        });
        const list = Array.isArray(found) ? found : [];
        return list.map((m) => ({
          model: m.model ? m.model : UNKNOWN_MODEL_FILTER,
          label: m.model || 'Unknown',
        }));
      } catch (err) {
        toastError('Failed to load models', err);
        return [];
      }
    },
    [days, userId]
  );

  useEffect(() => {
    if (!userId) {
      setSelectedUserLabel(null);
      return;
    }
    usersService
      .get(userId)
      .then((u) => setSelectedUserLabel(u?.username || `User ${userId}`))
      .catch(() => setSelectedUserLabel(`User ${userId}`));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    usageService
      .breakdown(usageFilterPayload({ days, repo, agentType, userId, model }))
      .then((d) => !cancelled && setRows(Array.isArray(d) ? d : []))
      .catch((err) => {
        if (!cancelled) {
          setRows([]);
          toastError('Failed to load usage breakdown', err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [days, repo, agentType, userId, model]);

  const data = useMemo(() => rows ?? [], [rows]);
  const activeDimension = useMemo(
    () =>
      resolveUsageDimension(
        selectedDay ? data.filter((r) => r.day === selectedDay) : data,
        dimension
      ),
    [data, selectedDay, dimension]
  );
  const tableRows = useMemo(() => {
    const scoped = selectedDay ? data.filter((r) => r.day === selectedDay) : data;
    return aggregateUsage(scoped, { dimension: activeDimension });
  }, [data, selectedDay, activeDimension]);
  const totals = useMemo(() => {
    const scoped = selectedDay ? data.filter((r) => r.day === selectedDay) : data;
    return sumUsageMetrics(scoped);
  }, [data, selectedDay]);
  const showCost = data.some((r) => Number(r.cost_usd) > 0);
  const loading = rows === null;

  const duplicateNames = useMemo(
    () => duplicateRepoDisplayNames(repos.map((r) => r.full_name)),
    [repos]
  );
  const repoOptions = useMemo(
    () => [
      { value: '', label: 'All repos' },
      { value: GLOBAL_SCOPE, label: 'Global' },
      ...repos.map((r) => ({
        value: r.full_name,
        label: formatRepoLabel(r.full_name, duplicateNames),
      })),
    ],
    [repos, duplicateNames]
  );

  if (searchParams.get('tab') === 'pricing') {
    return <Navigate to="/model-pricing" replace />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-fg">Usage</h1>
          <p className="text-sm text-fg-muted mt-1 max-w-2xl">
            System-wide token activity. Filter by user, model, repository, or agent type; click a
            day on the timeline to zoom the table. Costs use the{' '}
            <Link to="/model-pricing" className="text-accent hover:underline">
              model pricing table
            </Link>
            .
          </p>
        </div>
      </div>

      <ActiveAgentsSection userId={userId || null} showUser={!userId} />

      <div className="flex flex-wrap items-end gap-3">
        <FilterField label="User">
          <SearchableSelect
            value={userId}
            onChange={(id) => setFilter({ user_id: id })}
            getOptions={getUsageUserOptions}
            asyncRefetchKey={days}
            placeholder="All users"
            emptyText="No users with usage"
            getOptionValue={(u) => String(u.user_id)}
            getOptionLabel={(u) => u.username || `User ${u.user_id}`}
            renderSelected={() => selectedUserLabel ?? (userId ? `User ${userId}` : '')}
          />
        </FilterField>
        <FilterField label="Model">
          <SearchableSelect
            value={model}
            onChange={(id) => setFilter({ model: id })}
            getOptions={getUsageModelOptions}
            asyncRefetchKey={`${days}:${userId}`}
            placeholder="All models"
            emptyText="No models with usage"
            getOptionValue={(m) => m.model}
            getOptionLabel={(m) => m.label}
            renderSelected={() => (model === UNKNOWN_MODEL_FILTER ? 'Unknown' : model)}
          />
        </FilterField>
        <FilterField label="Repo">
          <SearchableSelect
            value={repo}
            onChange={(value) => setFilter({ repo: value })}
            options={repoOptions}
            placeholder="All repos"
            emptyText="No repositories"
            getOptionValue={(o) => o.value}
            getOptionLabel={(o) => o.label}
          />
        </FilterField>
        <FilterField label="Agent type">
          <SearchableSelect
            value={agentType}
            onChange={(value) => setFilter({ agent_type: value })}
            options={AGENT_TYPE_OPTIONS}
            placeholder="All types"
            getOptionValue={(o) => o.value}
            getOptionLabel={(o) => o.label}
          />
        </FilterField>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-faint">Range</span>
          <div className="flex items-center gap-1.5 h-[2.625rem]">
            {USAGE_DAY_OPTIONS.map((n) => (
              <FilterChip
                key={n}
                active={days === n}
                onClick={() => setFilter({ days: String(n) })}
              >
                {n}d
              </FilterChip>
            ))}
          </div>
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
          hint={showCost ? 'Estimated from model pricing table' : 'No cost in this range'}
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
        <div className="px-4 sm:px-6 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-heading">
            {usageDimensionHeading(activeDimension)}
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
                  <th className="font-medium px-4 sm:px-6 py-2">
                    {usageDimensionHeading(activeDimension).replace(/^By /, '')}
                  </th>
                  <th className="font-medium px-3 py-2 w-full min-w-32">Tokens</th>
                  <th className="font-medium px-3 py-2 text-right whitespace-nowrap">In</th>
                  <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Out</th>
                  <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Cache read</th>
                  <th className="font-medium px-3 py-2 text-right whitespace-nowrap">
                    Cache write
                  </th>
                  {showCost && <th className="font-medium px-4 sm:px-6 py-2 text-right">Cost</th>}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => {
                  const share = totals.total_tokens
                    ? (row.total_tokens / totals.total_tokens) * 100
                    : 0;
                  return (
                    <tr key={row.group_key} className="border-b border-line/80 last:border-0">
                      <td className="px-4 sm:px-6 py-2.5 text-heading">
                        {activeDimension === 'model' ? (
                          <UsageModelLabel
                            model={row.model}
                            className="block truncate max-w-[18rem]"
                          />
                        ) : (
                          <span title={usageGroupTitle(row, activeDimension)}>
                            {usageGroupLabel(row, activeDimension)}
                          </span>
                        )}
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
                      <td className="px-3 py-2.5 text-right text-fg-muted tabular-nums whitespace-nowrap">
                        {formatTokens(row.input_tokens)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-fg-muted tabular-nums whitespace-nowrap">
                        {formatTokens(row.output_tokens)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-fg-muted tabular-nums whitespace-nowrap">
                        {formatTokens(row.cache_read_tokens)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-fg-muted tabular-nums whitespace-nowrap">
                        {formatTokens(row.cache_write_tokens)}
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

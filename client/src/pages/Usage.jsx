import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Layers } from 'lucide-react';
import UsageGraph from '../components/UsageGraph.jsx';
import UsageModelLabel from '../components/UsageModelLabel.jsx';
import ActiveAgentsSection from '../components/ActiveAgentsSection.jsx';
import UsagePricingTab from '../components/UsagePricingTab.jsx';
import RepoDropdown, { repoDropdownRepoSections } from '../components/RepoDropdown.jsx';
import SearchableSelect from '../components/SearchableSelect/index.jsx';
import { usageService, usersService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { chipOptionClassName } from '../components/LightChipDropdown.jsx';
import { useRepoContext, GLOBAL_SCOPE } from '../context/RepoContext.jsx';
import { AGENT_MODEL_PRICING_DOC_URL } from '@baguette/shared/agent-model-pricing.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import {
  KIND_LABELS,
  USAGE_DAY_OPTIONS,
  UNKNOWN_CONFIG_KEY,
  aggregateUsage,
  formatTokens,
  formatUsd,
  metricOf,
  parseUsageDays,
  sumUsageMetrics,
  usageConfigLabel,
  usageRepoLabel,
  usageRepoTitle,
} from '../utils/usageSeries.js';

function usageFilterPayload({ days, repo, agentConfigId, kind, userId }) {
  const payload = { days: String(days) };
  if (repo) payload.repo = repo;
  if (agentConfigId) payload.agent_config_id = agentConfigId;
  if (kind) payload.kind = kind;
  if (userId) payload.user_id = String(userId);
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
  const agentConfigId = searchParams.get('agent_config_id') || '';
  const kind = searchParams.get('kind') || '';
  const userId = searchParams.get('user_id') || '';
  const tab = searchParams.get('tab') === 'pricing' ? 'pricing' : 'usage';

  const [rows, setRows] = useState(null);
  const [selectedUserLabel, setSelectedUserLabel] = useState(null);
  const [agentConfigs, setAgentConfigs] = useState([]);
  const [dimension, setDimension] = useState('repo');
  const [selectedDay, setSelectedDay] = useState(null);
  const [byModel, setByModel] = useState(false);

  const setFilter = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
    setSelectedDay(null);
  };

  const getUsageUserOptions = useCallback(
    async (query) => {
      try {
        const rows = await usageService.usageUsers({
          days: String(days),
          q: query,
        });
        return Array.isArray(rows) ? rows : [];
      } catch (err) {
        toastError('Failed to load users', err);
        return [];
      }
    },
    [days]
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
    if (tab !== 'usage') return undefined;
    usageService
      .agentConfigs(usageFilterPayload({ days, userId }))
      .then((d) => setAgentConfigs(Array.isArray(d) ? d : []))
      .catch(() => setAgentConfigs([]));
  }, [days, userId, tab]);

  useEffect(() => {
    if (tab !== 'usage') return undefined;
    let cancelled = false;
    setRows(null);
    usageService
      .breakdown(usageFilterPayload({ days, repo, agentConfigId, kind, userId }))
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
  }, [days, repo, agentConfigId, kind, userId, tab]);

  const data = useMemo(() => rows ?? [], [rows]);
  const tableRows = useMemo(() => {
    const scoped = selectedDay ? data.filter((r) => r.day === selectedDay) : data;
    return aggregateUsage(scoped, { byModel });
  }, [data, selectedDay, byModel]);
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
            System-wide token activity. Filter by user or repository; click a day on the timeline to
            zoom the table. Costs use the{' '}
            <a
              href={AGENT_MODEL_PRICING_DOC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              model pricing table
            </a>{' '}
            (built-in list prices plus any custom rows on the Pricing tab).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <FilterChip active={tab === 'usage'} onClick={() => setFilter({ tab: '' })}>
              Overview
            </FilterChip>
            <FilterChip active={tab === 'pricing'} onClick={() => setFilter({ tab: 'pricing' })}>
              Pricing
            </FilterChip>
          </div>
          {tab === 'usage' && (
            <div className="flex flex-wrap items-center gap-1.5">
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
          )}
        </div>
      </div>

      {tab === 'usage' && <ActiveAgentsSection userId={userId || null} showUser={!userId} />}

      {tab === 'usage' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-fg-muted min-w-0">
            <span className="text-xs text-faint shrink-0">User</span>
            <div className="w-[min(100%,12rem)] min-w-[9rem]">
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
            </div>
            {userId ? (
              <FilterChip active={false} onClick={() => setFilter({ user_id: '' })}>
                All users
              </FilterChip>
            ) : null}
          </div>
          <RepoDropdown
            value={repo}
            onChange={(value) => setFilter({ repo: value })}
            sections={repoSections}
            ariaLabel="Filter by repository"
            placement="bottom-start"
          />
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <span className="text-xs text-faint shrink-0">Config</span>
            <select
              value={agentConfigId}
              onChange={(e) => setFilter({ agent_config_id: e.target.value })}
              className="rounded-lg border border-line bg-control px-2 py-1.5 text-sm text-heading max-w-[14rem]"
              aria-label="Filter by agent configuration"
            >
              <option value="">All configurations</option>
              {agentConfigs.map((c) => (
                <option
                  key={c.agent_config_id ?? UNKNOWN_CONFIG_KEY}
                  value={c.agent_config_id == null ? '__none__' : String(c.agent_config_id)}
                >
                  {c.label}
                  {c.sdk ? ` (${formatAgentSdkDisplayName(c.sdk)})` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1.5">
            <FilterChip active={!kind} onClick={() => setFilter({ kind: '' })}>
              All activity
            </FilterChip>
            <FilterChip active={kind === 'session'} onClick={() => setFilter({ kind: 'session' })}>
              {KIND_LABELS.session}
            </FilterChip>
            <FilterChip active={kind === 'review'} onClick={() => setFilter({ kind: 'review' })}>
              Review
            </FilterChip>
          </div>
        </div>
      )}

      {tab === 'pricing' ? (
        <UsagePricingTab />
      ) : (
        <>
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
                By repository
                {selectedDay ? (
                  <span className="font-normal text-faint"> · {selectedDay}</span>
                ) : null}
              </h2>
              <div className="flex items-center gap-2">
                <FilterChip active={byModel} onClick={() => setByModel((v) => !v)}>
                  Breakdown by model
                </FilterChip>
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
            </div>
            {loading ? (
              <p className="px-4 sm:px-6 py-8 text-sm text-faint">Loading details…</p>
            ) : tableRows.length === 0 ? (
              <p className="px-4 sm:px-6 py-8 text-sm text-faint">
                Nothing to list for these filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-faint border-b border-line">
                      <th className="font-medium px-4 sm:px-6 py-2">Repo</th>
                      {byModel && <th className="font-medium px-3 py-2">Model</th>}
                      <th className="font-medium px-3 py-2">Configuration</th>
                      <th className="font-medium px-3 py-2">Activity</th>
                      <th className="font-medium px-3 py-2 w-full min-w-32">Tokens</th>
                      <th className="font-medium px-3 py-2 text-right whitespace-nowrap">In</th>
                      <th className="font-medium px-3 py-2 text-right whitespace-nowrap">Out</th>
                      <th className="font-medium px-3 py-2 text-right whitespace-nowrap">
                        Cache read
                      </th>
                      <th className="font-medium px-3 py-2 text-right whitespace-nowrap">
                        Cache write
                      </th>
                      {showCost && (
                        <th className="font-medium px-4 sm:px-6 py-2 text-right">Cost</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => {
                      const share = totals.total_tokens
                        ? (row.total_tokens / totals.total_tokens) * 100
                        : 0;
                      return (
                        <tr
                          key={`${row.repo_full_name}:${row.agent_config_id ?? 'none'}:${row.kind}:${byModel ? row.model : ''}`}
                          className="border-b border-line/80 last:border-0"
                        >
                          <td className="px-4 sm:px-6 py-2.5 text-heading">
                            <span title={usageRepoTitle(row.repo_full_name)}>
                              {usageRepoLabel(row.repo_full_name)}
                            </span>
                          </td>
                          {byModel && (
                            <td className="px-3 py-2.5 text-fg-muted">
                              <UsageModelLabel
                                model={row.model}
                                className="block truncate max-w-[14rem]"
                              />
                            </td>
                          )}
                          <td className="px-3 py-2.5 text-fg-muted">
                            <span
                              title={
                                row.agent_sdk ? formatAgentSdkDisplayName(row.agent_sdk) : undefined
                              }
                            >
                              {usageConfigLabel(row)}
                            </span>
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
        </>
      )}
    </div>
  );
}

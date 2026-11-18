import { agentAccessibleTitle, agentDisplayTitle } from '../../shared/agent-display-title.js';
import { normalizeUsageAgentType } from '../../shared/usage-agent-type.js';
import { getSdkPlugin } from '../agent-sdks/registry.js';
import { listAgentsForSession } from './agents-db.js';

function formatTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function formatUsd(n) {
  const value = Number(n) || 0;
  if (value <= 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 100) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(0)}`;
}

function usageLabelExtras(row) {
  return getSdkPlugin(row.agent_sdk)?.usageLabelExtras?.(row) ?? {};
}

function agentUsageGroupKey(row) {
  if (row.agent_id != null) return `id:${row.agent_id}`;
  return `type:${row.agent_type}`;
}

/**
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 */
async function querySessionUsageByModel(db, sessionId) {
  const rows = await db('usage')
    .where({ session_id: sessionId })
    .select('agent_id', 'agent_type', 'model', 'model_params', 'agent_sdk')
    .sum('cost_usd as cost_usd')
    .sum('input_tokens as input_tokens')
    .sum('output_tokens as output_tokens')
    .sum('cache_read_tokens as cache_read_tokens')
    .sum('cache_write_tokens as cache_write_tokens')
    .sum('total_tokens as total_tokens')
    .groupByRaw('agent_id, agent_type, model, model_params, agent_sdk')
    .orderBy('agent_id')
    .orderBy('agent_sdk')
    .orderBy('model')
    .orderBy('agent_type');

  return rows.map((r) => ({
    agent_id: r.agent_id != null ? Number(r.agent_id) : null,
    agent_type: normalizeUsageAgentType(r.agent_type),
    model: r.model || 'unknown',
    agent_sdk: r.agent_sdk || 'claude',
    model_params: r.model_params ?? null,
    cost_usd: parseFloat(r.cost_usd ?? 0),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
    cache_read_tokens: Number(r.cache_read_tokens ?? 0),
    cache_write_tokens: Number(r.cache_write_tokens ?? 0),
    total_tokens: Number(r.total_tokens ?? 0),
  }));
}

/**
 * Merge usage rows that share agent, agent_sdk, model, and plugin extras
 * (e.g. Cursor `fast` from `usageLabelExtras`).
 *
 * @param {ReturnType<typeof querySessionUsageByModel> extends Promise<infer T> ? T : never} rows
 */
export function mergeUsageForPrFooter(rows) {
  const merged = new Map();

  for (const row of rows) {
    const agent_type = normalizeUsageAgentType(row.agent_type);
    const fast = usageLabelExtras(row).fast === true;
    const key = `${agentUsageGroupKey({ ...row, agent_type })}\0${row.agent_sdk}\0${row.model}\0${fast ? '1' : '0'}`;
    const prev = merged.get(key);
    if (prev) {
      prev.input_tokens += row.input_tokens;
      prev.output_tokens += row.output_tokens;
      prev.cache_read_tokens += row.cache_read_tokens;
      prev.cache_write_tokens += row.cache_write_tokens;
      prev.total_tokens += row.total_tokens;
      prev.cost_usd += row.cost_usd;
    } else {
      merged.set(key, {
        agent_id: row.agent_id,
        agent_type,
        agent_sdk: row.agent_sdk,
        model: row.model,
        fast,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cache_write_tokens: row.cache_write_tokens,
        total_tokens: row.total_tokens,
        cost_usd: row.cost_usd,
      });
    }
  }

  return [...merged.values()];
}

function formatSlackModelLabel(row) {
  if (row.fast) {
    return `${row.model} (Fast)`;
  }
  return row.model;
}

function rowTokenTotal(row) {
  const fromTotal = Number(row.total_tokens) || 0;
  if (fromTotal > 0) return fromTotal;
  return (
    (Number(row.input_tokens) || 0) +
    (Number(row.output_tokens) || 0) +
    (Number(row.cache_read_tokens) || 0) +
    (Number(row.cache_write_tokens) || 0)
  );
}

/** One model segment: `composer-2.5 $1.20 / 15k tokens` */
export function formatPrFooterModelSegment(row) {
  const model = formatSlackModelLabel(row);
  return `${model} ${formatUsd(row.cost_usd)} / ${formatTokens(rowTokenTotal(row))} tokens`;
}

function resolveAgentLabel(row, agentsById) {
  if (row.agent_id != null) {
    const agent = agentsById.get(row.agent_id);
    if (agent) return agentAccessibleTitle(agent);
  }
  return agentDisplayTitle({ name: row.agent_type, agent_type: row.agent_type });
}

/**
 * @param {ReturnType<typeof mergeUsageForPrFooter>} rows
 * @param {Array<{ id: number; name?: string; agent_type?: string }>} [agents]
 * @returns {string[]}
 */
export function formatPrFooterUsageLines(rows, agents = []) {
  if (!rows.length) return [];

  const agentsById = new Map(agents.map((a) => [a.id, a]));
  const byAgent = new Map();

  for (const row of rows) {
    const key = agentUsageGroupKey(row);
    const list = byAgent.get(key) ?? { key, rows: [], label: resolveAgentLabel(row, agentsById) };
    list.rows.push(row);
    byAgent.set(key, list);
  }

  const agentGroups = [...byAgent.values()]
    .map((group) => {
      const totalCost = group.rows.reduce((sum, row) => sum + row.cost_usd, 0);
      const modelRows = [...group.rows].sort((a, b) => b.cost_usd - a.cost_usd);
      return { ...group, totalCost, modelRows };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const totalCost = rows.reduce((sum, row) => sum + row.cost_usd, 0);
  const lines = ['LLM Usage:'];
  for (const { label, modelRows } of agentGroups) {
    const segments = modelRows.map((row) => formatPrFooterModelSegment(row));
    lines.push(`- ${label} - ${segments.join(', ')}`);
  }
  lines.push(`Total: ${formatUsd(totalCost)}`);
  return lines;
}

/**
 * @param {import('knex').Knex} db
 * @param {Record<string, unknown>} session
 * @returns {Promise<string[]>}
 */
export async function loadSessionFooterUsageLines(db, session) {
  if (!session?.id) return [];
  const rows = await querySessionUsageByModel(db, session.id);
  if (!rows.length) return [];
  const agents = await listAgentsForSession(db, session.id);
  return formatPrFooterUsageLines(mergeUsageForPrFooter(rows), agents);
}

/**
 * One-line models + session cost for Slack message footers.
 *
 * @param {ReturnType<typeof mergeUsageForPrFooter>} rows
 * @returns {string | null}
 */
export function formatSlackFooterUsageSummary(rows) {
  if (!rows.length) return null;
  const modelLabels = [];
  const seen = new Set();
  const sorted = [...rows].sort((a, b) => b.cost_usd - a.cost_usd);
  for (const row of sorted) {
    const label = formatSlackModelLabel(row);
    if (seen.has(label)) continue;
    seen.add(label);
    modelLabels.push(label);
  }
  const totalCost = rows.reduce((sum, row) => sum + row.cost_usd, 0);
  return `${modelLabels.join(', ')} · ${formatUsd(totalCost)}`;
}

/**
 * @param {import('knex').Knex} db
 * @param {Record<string, unknown>} session
 * @returns {Promise<string | null>}
 */
export async function loadSessionSlackFooterUsageSummary(db, session) {
  if (!session?.id) return null;
  const rows = await querySessionUsageByModel(db, session.id);
  if (!rows.length) return null;
  return formatSlackFooterUsageSummary(mergeUsageForPrFooter(rows));
}

import { parseModelParamsJson } from '../../shared/cursor-model-pricing.js';

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

function usageKind(row) {
  return row.usage_kind === 'review' || row.kind === 'review' ? 'review' : 'session';
}

function cursorFastEnabled(session, kind) {
  const paramsJson =
    kind === 'review'
      ? (session.review_model_params ?? session.model_params)
      : session.model_params;
  return parseModelParamsJson(paramsJson).fast === 'true';
}

/**
 * @param {import('knex').Knex} db
 * @param {number} sessionId
 */
export async function querySessionUsageByModel(db, sessionId) {
  const rows = await db('usage')
    .where({ session_id: sessionId })
    .select(
      db.raw("CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END as usage_kind"),
      'model',
      'agent_sdk'
    )
    .sum('cost_usd as cost_usd')
    .sum('input_tokens as input_tokens')
    .sum('output_tokens as output_tokens')
    .sum('cache_read_tokens as cache_read_tokens')
    .sum('cache_write_tokens as cache_write_tokens')
    .groupByRaw("CASE WHEN kind = 'review' THEN 'review' ELSE 'session' END, model, agent_sdk")
    .orderBy('agent_sdk')
    .orderBy('model')
    .orderBy('usage_kind');

  return rows.map((r) => ({
    kind: usageKind(r),
    model: r.model || 'unknown',
    agent_sdk: r.agent_sdk || 'claude',
    cost_usd: parseFloat(r.cost_usd ?? 0),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
    cache_read_tokens: Number(r.cache_read_tokens ?? 0),
    cache_write_tokens: Number(r.cache_write_tokens ?? 0),
  }));
}

/**
 * Merge usage rows that share agent_sdk, model, and Cursor fast flag (from session snapshots).
 *
 * @param {ReturnType<typeof querySessionUsageByModel> extends Promise<infer T> ? T : never} rows
 * @param {Record<string, unknown>} session
 */
export function mergeUsageForPrFooter(rows, session) {
  const merged = new Map();

  for (const row of rows) {
    const fast = row.agent_sdk === 'cursor' ? cursorFastEnabled(session, row.kind) : false;
    const key = `${row.agent_sdk}\0${row.model}\0${fast ? '1' : '0'}`;
    const prev = merged.get(key);
    if (prev) {
      prev.input_tokens += row.input_tokens;
      prev.output_tokens += row.output_tokens;
      prev.cache_read_tokens += row.cache_read_tokens;
      prev.cache_write_tokens += row.cache_write_tokens;
      prev.cost_usd += row.cost_usd;
    } else {
      merged.set(key, {
        agent_sdk: row.agent_sdk,
        model: row.model,
        fast,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_read_tokens: row.cache_read_tokens,
        cache_write_tokens: row.cache_write_tokens,
        cost_usd: row.cost_usd,
      });
    }
  }

  return [...merged.values()].sort((a, b) => {
    const sdk = a.agent_sdk.localeCompare(b.agent_sdk);
    if (sdk !== 0) return sdk;
    const model = a.model.localeCompare(b.model);
    if (model !== 0) return model;
    return Number(b.fast) - Number(a.fast);
  });
}

export function formatPrFooterUsageLine(row) {
  const label = `${row.agent_sdk} / \`${row.model}\`${row.fast ? ' (Fast)' : ''}`;
  return (
    `${label} · In: ${formatTokens(row.input_tokens)} · Out: ${formatTokens(row.output_tokens)}` +
    ` · Cache read: ${formatTokens(row.cache_read_tokens)}` +
    ` · Cache write: ${formatTokens(row.cache_write_tokens)}` +
    ` · Cost: ${formatUsd(row.cost_usd)}`
  );
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
  return mergeUsageForPrFooter(rows, session).map(formatPrFooterUsageLine);
}

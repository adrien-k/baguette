import { estimatePersistedUsageRowCostUsdSync } from './usage-row-cost.js';
import { warmUsageModelPricingCache } from './usage-model-pricing.js';

/** SQLite default variable limit is 999; each row uses id + cost_usd + id in IN. */
const USAGE_UPDATE_CHUNK = 200;

/**
 * @param {import('knex').Knex.Transaction} trx
 * @param {{ id: number, cost_usd: number }[]} updates
 */
async function batchUpdateUsageCosts(trx, updates) {
  for (let i = 0; i < updates.length; i += USAGE_UPDATE_CHUNK) {
    const chunk = updates.slice(i, i + USAGE_UPDATE_CHUNK);
    const caseParts = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const bindings = [];
    for (const row of chunk) {
      bindings.push(row.id, row.cost_usd);
    }
    const idPlaceholders = chunk.map(() => '?').join(', ');
    bindings.push(...chunk.map((row) => row.id));
    await trx.raw(
      `UPDATE usage SET cost_usd = CASE id ${caseParts} END WHERE id IN (${idPlaceholders})`,
      bindings
    );
  }
}

/**
 * @param {import('knex').Knex} db
 * @param {number[]} sessionIds
 */
async function refreshSessionTotalCosts(db, sessionIds) {
  if (sessionIds.length === 0) return;
  const placeholders = sessionIds.map(() => '?').join(', ');
  await db.raw(
    `UPDATE sessions
     SET total_cost_usd = (
       SELECT COALESCE(SUM(cost_usd), 0) FROM usage WHERE usage.session_id = sessions.id
     )
     WHERE id IN (${placeholders})`,
    sessionIds
  );
}

/**
 * @param {import('knex').Knex} db
 * @param {string|null} modelId
 */
async function countSkippedClaudeUsageRows(db, modelId) {
  let query = db('usage').where('agent_sdk', 'claude');
  if (modelId) query = query.where('model', modelId);
  const row = await query.count('* as count').first();
  return Number(row?.count ?? 0);
}

function recomputeResult({ modelId, updatedRows, affectedSessions, skippedClaudeRows }) {
  return {
    updated_rows: updatedRows,
    affected_sessions: affectedSessions,
    model_id: modelId ?? null,
    claude_usage_excluded: true,
    skipped_claude_rows: skippedClaudeRows,
  };
}

/**
 * Recompute `usage.cost_usd` from stored tokens and refresh `sessions.total_cost_usd`.
 * Claude rows keep SDK-reported `cost_usd` and are skipped.
 *
 * @param {import('knex').Knex} db
 * @param {{ modelId?: string|null, dryRun?: boolean }} [options]
 */
export async function recomputeUsageCosts(db, { modelId = null, dryRun = false } = {}) {
  const skippedClaudeRows = await countSkippedClaudeUsageRows(db, modelId);
  let query = db('usage as u')
    .join('sessions as s', 's.id', 'u.session_id')
    .select(
      'u.id',
      'u.session_id',
      'u.kind',
      'u.model',
      'u.agent_sdk',
      'u.raw_token_usage',
      'u.input_tokens',
      'u.output_tokens',
      'u.cache_read_tokens',
      'u.cache_write_tokens',
      'u.reasoning_tokens',
      'u.total_tokens',
      's.model as session_model',
      's.model_params',
      's.review_model',
      's.review_model_params'
    )
    .orderBy('u.id')
    .whereNot('u.agent_sdk', 'claude');

  if (modelId) query = query.where('u.model', modelId);

  const rows = await query;
  if (rows.length === 0) {
    return recomputeResult({
      modelId,
      updatedRows: 0,
      affectedSessions: 0,
      skippedClaudeRows,
    });
  }

  await warmUsageModelPricingCache(db);

  const affectedSessionIds = new Set();
  const updates = [];

  for (const row of rows) {
    const costUsd = estimatePersistedUsageRowCostUsdSync(row);
    affectedSessionIds.add(row.session_id);
    updates.push({ id: row.id, cost_usd: costUsd, session_id: row.session_id });
  }

  if (!dryRun && updates.length > 0) {
    await db.transaction(async (trx) => {
      await batchUpdateUsageCosts(trx, updates);
    });
    await refreshSessionTotalCosts(db, [...affectedSessionIds]);
  }

  return recomputeResult({
    modelId,
    updatedRows: updates.length,
    affectedSessions: affectedSessionIds.size,
    skippedClaudeRows,
  });
}

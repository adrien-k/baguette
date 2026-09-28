/* eslint-disable no-console -- CLI progress and summary */
/**
 * Recompute `usage.cost_usd` for Cursor rows that have token counts but zero cost,
 * then refresh `sessions.total_cost_usd` for affected sessions.
 *
 * Usage: node server/scripts/backfill-cursor-usage-cost.js [--dry-run]
 */
import knex from 'knex';
import knexfile from '../../knexfile.js';
import { estimateCursorUsageCostUsd, turnUsageFromUsageRow } from '../lib/cursor-usage-row-cost.js';

const dryRun = process.argv.includes('--dry-run');
const db = knex(knexfile);

function reportProgress(done, total) {
  const pct = total === 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));
  process.stdout.write(`\rBackfill progress: ${pct}% (${done}/${total})`);
}

try {
  const candidates = await db('usage as u')
    .join('sessions as s', 's.id', 'u.session_id')
    .where('u.agent_sdk', 'cursor')
    .where('u.cost_usd', 0)
    .where('u.total_tokens', '>', 0)
    .select(
      'u.id',
      'u.session_id',
      'u.kind',
      'u.model as usage_model',
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
    .orderBy('u.id');

  const total = candidates.length;
  reportProgress(0, total);

  const affectedSessionIds = new Set();
  let updatedRows = 0;
  let done = 0;

  for (const row of candidates) {
    const session = {
      model: row.session_model,
      model_params: row.model_params,
      review_model: row.review_model,
      review_model_params: row.review_model_params,
    };
    const turnUsage = turnUsageFromUsageRow({ ...row, model: row.usage_model });
    const costUsd = estimateCursorUsageCostUsd(turnUsage, session, { kind: row.kind });

    if (costUsd > 0) {
      if (!dryRun) {
        await db('usage').where({ id: row.id }).update({ cost_usd: costUsd });
      }
      affectedSessionIds.add(row.session_id);
      updatedRows += 1;
    }

    done += 1;
    reportProgress(done, total);
  }

  process.stdout.write('\n');

  if (!dryRun && affectedSessionIds.size > 0) {
    const sessionIds = [...affectedSessionIds];
    const totals = await db('usage')
      .whereIn('session_id', sessionIds)
      .groupBy('session_id')
      .select('session_id')
      .sum('cost_usd as total_cost');

    for (const row of totals) {
      await db('sessions')
        .where({ id: row.session_id })
        .update({ total_cost_usd: parseFloat(row.total_cost ?? 0) });
    }
  }

  console.log(
    dryRun
      ? `Dry run: would update ${updatedRows} usage row(s) across ${affectedSessionIds.size} session(s).`
      : `Updated ${updatedRows} usage row(s); refreshed totals for ${affectedSessionIds.size} session(s).`
  );
  if (total === 0) {
    console.log('No Cursor usage rows with tokens and zero cost.');
  }
} finally {
  await db.destroy();
}

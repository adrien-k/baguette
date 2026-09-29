/* eslint-disable no-console -- CLI progress and summary */
/**
 * Recompute derived `input_tokens` / `total_tokens` and `usage.cost_usd` for every
 * Cursor row from its stored `raw_token_usage` JSON, then refresh
 * `sessions.total_cost_usd`. Does not rewrite `raw_token_usage` — that snapshot is
 * the source of truth (see `shared/cursor-token-adjustment.js`).
 *
 * Usage: node server/scripts/recompute-cursor-usage.js [--dry-run]
 */
import knex from 'knex';
import knexfile from '../../knexfile.js';
import {
  deriveCursorUsageFromRaw,
  parseCursorRawTokenUsage,
} from '../../shared/cursor-token-adjustment.js';
import { estimateCursorUsageCostUsd } from '../lib/cursor-usage-row-cost.js';

const dryRun = process.argv.includes('--dry-run');
const db = knex(knexfile);

function reportProgress(done, total) {
  const pct = total === 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));
  process.stdout.write(`\rRecompute progress: ${pct}% (${done}/${total})`);
}

try {
  const candidates = await db('usage as u')
    .join('sessions as s', 's.id', 'u.session_id')
    .where('u.agent_sdk', 'cursor')
    .select(
      'u.id',
      'u.session_id',
      'u.kind',
      'u.model as usage_model',
      'u.raw_token_usage',
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
  let skippedRows = 0;
  let done = 0;

  for (const row of candidates) {
    const raw = parseCursorRawTokenUsage(row.raw_token_usage);
    if (!raw) {
      skippedRows += 1;
      done += 1;
      reportProgress(done, total);
      continue;
    }

    const session = {
      model: row.session_model,
      model_params: row.model_params,
      review_model: row.review_model,
      review_model_params: row.review_model_params,
    };

    const derived = deriveCursorUsageFromRaw(raw);
    const turnUsage = {
      ...raw,
      input_tokens: derived.input_tokens,
      total_tokens: derived.total_tokens,
      model: row.usage_model,
    };
    const costUsd = estimateCursorUsageCostUsd(turnUsage, session, { kind: row.kind });

    if (!dryRun) {
      await db('usage').where({ id: row.id }).update({
        input_tokens: derived.input_tokens,
        output_tokens: raw.output_tokens,
        cache_read_tokens: raw.cache_read_tokens,
        cache_write_tokens: raw.cache_write_tokens,
        reasoning_tokens: raw.reasoning_tokens,
        total_tokens: derived.total_tokens,
        cost_usd: costUsd,
      });
    }

    affectedSessionIds.add(row.session_id);
    updatedRows += 1;
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
      ? `Dry run: would recompute ${updatedRows} Cursor usage row(s) across ${affectedSessionIds.size} session(s).`
      : `Recomputed ${updatedRows} Cursor usage row(s); refreshed totals for ${affectedSessionIds.size} session(s).`
  );
  if (skippedRows > 0) {
    console.log(`Skipped ${skippedRows} row(s) with no parseable raw_token_usage.`);
  }
  if (total === 0) {
    console.log('No Cursor usage rows found.');
  }
} finally {
  await db.destroy();
}

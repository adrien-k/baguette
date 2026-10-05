/**
 * One-time normalization of legacy message rows after migration 045.
 *
 * Run manually against an existing database (fresh databases don't need it):
 *
 *   node scripts/2026100601_backfill-message-rows.js
 *
 * What it does per session (idempotent — already-typed rows are left alone):
 * 1. Stamps historical turn_id (increments on human/baguette user rows) and
 *    sets sessions.current_turn_id to the max.
 * 2. Merges tool-result-only `user` rows into the matching tool_call row, then
 *    deletes the carrier row.
 * 3. Rewrites assistant `tool_use` blobs into typed tool_call rows with explicit
 *    result shapes (shell JSON -> BashToolResult, etc.).
 * 4. Rewrites legacy `result` rows into typed `turn_result` rows.
 */
import { pathToFileURL } from 'node:url';

import Knex from 'knex';
import knexfile from '../knexfile.js';
import { isBaguetteUserMessage, isHumanUserMessage } from '../shared/turn-model.js';
import {
  buildToolCallComplete,
  buildToolCallStart,
  normalizeUserPayloadForStorage,
} from '../shared/session-message-mappers.js';
import { createSessionProgress } from './backfill-progress.js';

function parseJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

function isToolResultCarrierRow(row) {
  if (row.type !== 'user') return false;
  const p = parseJson(row.message_json);
  const content = p.message?.content;
  return (
    Array.isArray(content) && content.length > 0 && content.every((b) => b.type === 'tool_result')
  );
}

/**
 * @param {import('knex').Knex} knex
 * @param {{ reportProgress?: boolean }} [options]
 * @returns {Promise<{sessions: number, mergedToolResults: number, toolCallsRewritten: number, turnResultsRewritten: number}>}
 */
export async function backfillMessageRows(knex, { reportProgress = false } = {}) {
  const sessions = await knex('session_messages').distinct('session_id');
  const counts = {
    sessions: sessions.length,
    mergedToolResults: 0,
    toolCallsRewritten: 0,
    turnResultsRewritten: 0,
  };

  const progress = reportProgress
    ? createSessionProgress('Backfill messages', sessions.length)
    : null;

  for (const { session_id: sessionId } of sessions) {
    const rows = await knex('session_messages')
      .where({ session_id: sessionId })
      .orderBy('id', 'asc');

    // Index legacy tool-result carriers first: the matching tool_use assistant
    // row can appear before or after the carrier row.
    const toolResultsById = new Map();
    for (const row of rows) {
      if (!isToolResultCarrierRow(row)) continue;
      const parsed = parseJson(row.message_json);
      for (const block of parsed.message?.content ?? []) {
        toolResultsById.set(block.tool_use_id, {
          content: block.content,
          is_error: block.is_error,
        });
      }
    }

    let turnId = 0;
    for (const row of rows) {
      const parsed = parseJson(row.message_json);
      const view = { ...parsed, type: row.type };

      if (row.type === 'user' && (isHumanUserMessage(view) || isBaguetteUserMessage(view))) {
        turnId += 1;
      }

      if (isToolResultCarrierRow(row)) {
        await knex('session_messages').where({ id: row.id }).delete();
        counts.mergedToolResults++;
        continue;
      }

      const patch = { turn_id: turnId || null };

      if (row.type === 'assistant' && Array.isArray(parsed.message?.content)) {
        const toolUse = parsed.message.content.find((b) => b.type === 'tool_use');
        if (toolUse) {
          const start = buildToolCallStart(
            toolUse.id,
            toolUse.name,
            toolUse.input ?? {},
            row.created_at
          );
          const tr = toolResultsById.get(toolUse.id);
          const completed = tr
            ? buildToolCallComplete(start, {
                name: toolUse.name,
                args: toolUse.input,
                rawResult: tr.content,
                isError: tr.is_error,
                endedAt: row.created_at,
              })
            : start;
          patch.type = 'tool_call';
          patch.tool_call_id = toolUse.id;
          patch.tool_status = completed.status;
          patch.tool_started_at = completed.started_at;
          patch.tool_ended_at = completed.ended_at;
          patch.message_json = JSON.stringify(completed);
          counts.toolCallsRewritten++;
        }
      }

      if (row.type === 'user' && !patch.message_json) {
        patch.message_json = JSON.stringify(normalizeUserPayloadForStorage(parsed));
      }

      if (row.type === 'result') {
        patch.type = 'turn_result';
        patch.message_json = JSON.stringify({
          type: 'turn_result',
          status: parsed.subtype === 'success' && !parsed.is_error ? 'ok' : 'error',
          error_message: parsed.is_error ? String(parsed.result ?? '') : null,
          total_cost_usd: parsed.total_cost_usd ?? row.total_cost_usd ?? null,
        });
        counts.turnResultsRewritten++;
      }

      await knex('session_messages').where({ id: row.id }).update(patch);
    }

    if (turnId > 0) {
      await knex('sessions').where({ id: sessionId }).update({ current_turn_id: turnId });
    }

    progress?.sessionDone();
  }

  progress?.done();
  return counts;
}

async function main() {
  const db = Knex(knexfile);
  try {
    const counts = await backfillMessageRows(db, { reportProgress: true });
    console.log(
      `Backfilled ${counts.sessions} session(s): ` +
        `${counts.mergedToolResults} tool-result rows merged, ` +
        `${counts.toolCallsRewritten} tool_call rows rewritten, ` +
        `${counts.turnResultsRewritten} turn_result rows rewritten.`
    );
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

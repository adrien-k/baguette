/**
 * Collapse duplicate streamed assistant rows (legacy Cursor/Claude persistence).
 *
 *   node scripts/2026100602_backfill-dedupe-streamed-assistants.js
 *
 * Within each session, consecutive assistant rows that contain only text/thinking
 * (no tool_use) are grouped. Each group is collapsed to one row:
 * 1. Prefix dedup — cumulative stream chunks for text and thinking (independently).
 * 2. Remaining fragments are concatenated into one typed `{ type: 'assistant', blocks }` row.
 * 3. Single rows with redundant thinking/text blocks are coalesced in place.
 * 4. Consecutive `system` / `thinking_tokens` rows (Claude SDK stream estimates) collapse to
 *    the latest row with a minimal payload (no per-chunk uuid rows).
 *
 * Run after `2026100601_backfill-message-rows.js`. Safe to re-run (no-op when nothing to collapse).
 */
import { pathToFileURL } from 'node:url';

import Knex from 'knex';
import knexfile from '../knexfile.js';
import { applySessionMessageWrites, forEachSessionMessageGroup } from './backfill-db.js';
import { createSessionProgress } from './backfill-progress.js';

function parseJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

const HARD_BOUNDARY_TYPES = new Set([
  'user',
  'tool_call',
  'turn_result',
  'result',
  'system',
  'plan',
]);

function contentBlocks(payload, rowType) {
  if (payload.type === 'assistant' && Array.isArray(payload.blocks)) {
    return payload.blocks;
  }
  if (rowType === 'assistant' || payload.type === 'assistant') {
    const content = payload.message?.content;
    if (Array.isArray(content)) return content;
  }
  if (payload.type === 'thinking' && typeof payload.text === 'string') {
    return [{ type: 'thinking', thinking: payload.text }];
  }
  return [];
}

function hasToolUse(payload, rowType) {
  if (rowType === 'tool_call' || payload.type === 'tool_call') return true;
  return contentBlocks(payload, rowType).some((b) => b.type === 'tool_use');
}

/** Assistant row that is only streamed text/thinking (not a tool-call carrier). */
export function isStreamableAssistantRow(row) {
  if (row.type !== 'assistant') return false;
  const payload = parseJson(row.message_json);
  if (hasToolUse(payload, row.type)) return false;
  const blocks = contentBlocks(payload, row.type);
  if (blocks.length === 0) return false;
  return blocks.every((b) => b.type === 'text' || b.type === 'thinking');
}

function streamBlocks(payload, rowType) {
  return contentBlocks(payload, rowType)
    .filter((b) => b.type === 'text' || b.type === 'thinking')
    .map((b) =>
      b.type === 'text'
        ? { type: 'text', text: b.text ?? '' }
        : { type: 'thinking', thinking: b.thinking ?? '' }
    );
}

/** @param {string[]} parts — in stream order */
export function coalesceStringParts(parts) {
  if (!parts.length) return '';
  let acc = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i] ?? '';
    if (!p) continue;
    if (p === acc) continue;
    if (p.startsWith(acc)) {
      acc = p;
      continue;
    }
    if (acc.startsWith(p)) continue;
    acc += p;
  }
  return acc;
}

function streamFingerprint(blocks) {
  const textParts = blocks.filter((b) => b.type === 'text').map((b) => b.text);
  const thinkingParts = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking);
  return {
    text: coalesceStringParts(textParts),
    thinking: coalesceStringParts(thinkingParts),
  };
}

function buildAssistantBlocks(text, thinking) {
  const blocks = [];
  if (thinking) blocks.push({ type: 'thinking', thinking });
  if (text) blocks.push({ type: 'text', text });
  return { type: 'assistant', blocks };
}

function collapsePrefixChain(rows) {
  const kept = [];
  for (const row of rows) {
    const payload = parseJson(row.message_json);
    const fp = streamFingerprint(streamBlocks(payload, row.type));
    if (!kept.length) {
      kept.push({ row, fp });
      continue;
    }
    const last = kept[kept.length - 1];
    if (fp.text === last.fp.text && fp.thinking === last.fp.thinking) continue;
    if (fp.text.startsWith(last.fp.text) && fp.thinking.startsWith(last.fp.thinking)) {
      kept[kept.length - 1] = { row, fp };
      continue;
    }
    if (last.fp.text.startsWith(fp.text) && last.fp.thinking.startsWith(fp.thinking)) continue;
    kept.push({ row, fp });
  }
  return kept.map((k) => k.row);
}

function mergeStreamBlocks(rows) {
  const textParts = [];
  const thinkingParts = [];
  for (const row of rows) {
    const payload = parseJson(row.message_json);
    for (const b of streamBlocks(payload, row.type)) {
      if (b.type === 'text') textParts.push(b.text);
      if (b.type === 'thinking') thinkingParts.push(b.thinking);
    }
  }
  return buildAssistantBlocks(coalesceStringParts(textParts), coalesceStringParts(thinkingParts));
}

function normalizedMessageJson(row) {
  return JSON.stringify(mergeStreamBlocks([row]));
}

/**
 * @param {object[]} runRows — consecutive streamable assistant rows
 * @returns {{ keepId: number, deleteIds: number[], message_json: string } | null}
 */
export function isThinkingTokensRow(row) {
  if (row.type !== 'system') return false;
  if (row.subtype === 'thinking_tokens') return true;
  const payload = parseJson(row.message_json);
  return payload.type === 'system' && payload.subtype === 'thinking_tokens';
}

function normalizeThinkingTokensPayload(payload) {
  return {
    type: 'system',
    subtype: 'thinking_tokens',
    estimated_tokens: payload.estimated_tokens ?? null,
    estimated_tokens_delta: payload.estimated_tokens_delta ?? null,
  };
}

/**
 * @param {object[]} runRows — consecutive thinking_tokens system rows
 * @returns {{ keepId: number, deleteIds: number[], message_json: string } | null}
 */
export function collapseThinkingTokensRun(runRows) {
  if (!runRows.length) return null;
  const keep = runRows[runRows.length - 1];
  const message_json = JSON.stringify(normalizeThinkingTokensPayload(parseJson(keep.message_json)));
  const deleteIds = runRows.length > 1 ? runRows.slice(0, -1).map((r) => r.id) : [];
  if (!deleteIds.length && message_json === keep.message_json) return null;
  return { keepId: keep.id, deleteIds, message_json };
}

export function collapseStreamableAssistantRun(runRows) {
  if (runRows.length === 0) return null;

  if (runRows.length === 1) {
    const message_json = normalizedMessageJson(runRows[0]);
    if (message_json === runRows[0].message_json) return null;
    return { keepId: runRows[0].id, deleteIds: [], message_json };
  }

  const afterPrefix = collapsePrefixChain(runRows);
  const keep = afterPrefix[0];
  const deleteIds = runRows.filter((r) => r.id !== keep.id).map((r) => r.id);
  const merged = mergeStreamBlocks(afterPrefix);
  const message_json = JSON.stringify(merged);
  if (!deleteIds.length && message_json === keep.message_json) return null;
  return { keepId: keep.id, deleteIds, message_json };
}

/**
 * @param {object[]} rows
 * @returns {{ deleteIds: number[], patches: { id: number, patch: Record<string, unknown> }[], groupsCollapsed: number, rowsDeleted: number }}
 */
function planStreamedAssistantDedupeForSession(rows) {
  let run = [];
  const deleteIds = [];
  const patches = [];
  let groupsCollapsed = 0;
  let rowsDeleted = 0;

  const flushRun = () => {
    if (!run.length) return;
    const plan = collapseStreamableAssistantRun(run);
    run = [];
    if (!plan) return;
    patches.push({
      id: plan.keepId,
      patch: { type: 'assistant', message_json: plan.message_json },
    });
    if (plan.deleteIds.length) {
      deleteIds.push(...plan.deleteIds);
      rowsDeleted += plan.deleteIds.length;
    }
    groupsCollapsed += 1;
  };

  for (const row of rows) {
    if (isStreamableAssistantRow(row)) {
      run.push(row);
      continue;
    }
    flushRun();
    if (!HARD_BOUNDARY_TYPES.has(row.type)) {
      // thinking-only system rows, etc. — still break assistant runs
    }
  }
  flushRun();

  return { deleteIds, patches, groupsCollapsed, rowsDeleted };
}

/**
 * @param {object[]} rows
 * @returns {{ deleteIds: number[], patches: { id: number, patch: Record<string, unknown> }[], groupsCollapsed: number, rowsDeleted: number }}
 */
function planThinkingTokensDedupeForSession(rows) {
  let run = [];
  const deleteIds = [];
  const patches = [];
  let groupsCollapsed = 0;
  let rowsDeleted = 0;

  const flushRun = () => {
    if (!run.length) return;
    const plan = collapseThinkingTokensRun(run);
    run = [];
    if (!plan) return;
    patches.push({
      id: plan.keepId,
      patch: {
        type: 'system',
        subtype: 'thinking_tokens',
        message_json: plan.message_json,
      },
    });
    if (plan.deleteIds.length) {
      deleteIds.push(...plan.deleteIds);
      rowsDeleted += plan.deleteIds.length;
    }
    groupsCollapsed += 1;
  };

  for (const row of rows) {
    if (isThinkingTokensRow(row)) {
      run.push(row);
      continue;
    }
    flushRun();
  }
  flushRun();

  return { deleteIds, patches, groupsCollapsed, rowsDeleted };
}

function mergeDedupePlans(...plans) {
  const deleteIds = [];
  const patches = [];
  let groupsCollapsed = 0;
  let rowsDeleted = 0;
  for (const plan of plans) {
    deleteIds.push(...plan.deleteIds);
    patches.push(...plan.patches);
    groupsCollapsed += plan.groupsCollapsed;
    rowsDeleted += plan.rowsDeleted;
  }
  return { deleteIds, patches, groupsCollapsed, rowsDeleted };
}

/**
 * @param {import('knex').Knex} knex
 * @param {{ reportProgress?: boolean }} [options]
 * @returns {Promise<{ sessions: number, groupsCollapsed: number, rowsDeleted: number }>}
 */
export async function dedupeStreamedAssistantRows(knex, { reportProgress = false } = {}) {
  const sessions = await knex('session_messages').distinct('session_id');
  const counts = { sessions: sessions.length, groupsCollapsed: 0, rowsDeleted: 0 };

  const progress = reportProgress
    ? createSessionProgress('Dedupe streamed assistants', sessions.length)
    : null;

  await forEachSessionMessageGroup(knex, async (_sessionId, rows) => {
    const plan = planStreamedAssistantDedupeForSession(rows);
    counts.groupsCollapsed += plan.groupsCollapsed;
    counts.rowsDeleted += plan.rowsDeleted;
    await applySessionMessageWrites(knex, plan);
    progress?.sessionDone();
  });

  progress?.done();
  return counts;
}

/**
 * @param {import('knex').Knex} knex
 * @param {{ reportProgress?: boolean }} [options]
 * @returns {Promise<{ sessions: number, groupsCollapsed: number, rowsDeleted: number }>}
 */
export async function dedupeThinkingTokenRows(knex, { reportProgress = false } = {}) {
  const sessions = await knex('session_messages').distinct('session_id');
  const counts = { sessions: sessions.length, groupsCollapsed: 0, rowsDeleted: 0 };

  const progress = reportProgress
    ? createSessionProgress('Dedupe thinking_tokens', sessions.length)
    : null;

  await forEachSessionMessageGroup(knex, async (_sessionId, rows) => {
    const plan = planThinkingTokensDedupeForSession(rows);
    counts.groupsCollapsed += plan.groupsCollapsed;
    counts.rowsDeleted += plan.rowsDeleted;
    await applySessionMessageWrites(knex, plan);
    progress?.sessionDone();
  });

  progress?.done();
  return counts;
}

/**
 * Both dedupe passes in one table scan (used by the CLI entrypoint).
 * @param {import('knex').Knex} knex
 * @param {{ reportProgress?: boolean }} [options]
 */
async function dedupeLegacyStreamRows(knex, { reportProgress = false } = {}) {
  const sessions = await knex('session_messages').distinct('session_id');
  const assistantCounts = { sessions: sessions.length, groupsCollapsed: 0, rowsDeleted: 0 };
  const tokenCounts = { sessions: sessions.length, groupsCollapsed: 0, rowsDeleted: 0 };

  const progress = reportProgress
    ? createSessionProgress('Dedupe legacy stream rows', sessions.length)
    : null;

  await forEachSessionMessageGroup(knex, async (_sessionId, rows) => {
    const assistantPlan = planStreamedAssistantDedupeForSession(rows);
    const tokenPlan = planThinkingTokensDedupeForSession(rows);
    assistantCounts.groupsCollapsed += assistantPlan.groupsCollapsed;
    assistantCounts.rowsDeleted += assistantPlan.rowsDeleted;
    tokenCounts.groupsCollapsed += tokenPlan.groupsCollapsed;
    tokenCounts.rowsDeleted += tokenPlan.rowsDeleted;

    const merged = mergeDedupePlans(assistantPlan, tokenPlan);
    await applySessionMessageWrites(knex, merged);
    progress?.sessionDone();
  });

  progress?.done();
  return { assistantCounts, tokenCounts };
}

async function main() {
  const db = Knex(knexfile);
  try {
    const { assistantCounts, tokenCounts } = await dedupeLegacyStreamRows(db, {
      reportProgress: true,
    });
    console.log(
      `Deduped streamed assistants across ${assistantCounts.sessions} session(s): ` +
        `${assistantCounts.groupsCollapsed} group(s) collapsed, ` +
        `${assistantCounts.rowsDeleted} row(s) deleted.`
    );
    console.log(
      `Deduped thinking_tokens across ${tokenCounts.sessions} session(s): ` +
        `${tokenCounts.groupsCollapsed} group(s) collapsed, ${tokenCounts.rowsDeleted} row(s) deleted.`
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

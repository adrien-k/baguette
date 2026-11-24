import { baguetteMcpShortName } from '../../shared/baguette-mcp-tool-names.js';
import { parseMcpJsonResult } from '../../shared/parse-mcp-json-result.js';
import {
  deliverGitPushOutcomeToAgent,
  gitPushPrevDataFromToolPayload,
} from './git-push-agent-notify.js';

const GIT_PUSH_OUTCOMES = new Set(['canceled', 'pushed', 'failed']);

function isGitPushToolPayload(payload) {
  if (payload?.type !== 'tool_call' || payload?.kind !== 'mcp') return false;
  const short = baguetteMcpShortName(payload.name);
  const argTool = payload.args?.tool;
  return short === 'GitPush' || argTool === 'GitPush';
}

function gitPushResultData(payload) {
  const data = payload?.result?.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

/** Load candidate GitPush tool_call rows for a session approval `request_id`. */
export async function loadGitPushToolCallRowsForRequest(db, sessionId, requestId) {
  if (!sessionId || !requestId) return [];
  return db('session_messages')
    .where({ session_id: sessionId, type: 'tool_call' })
    .whereRaw('message_json LIKE ?', [`%${requestId}%`])
    .orderBy('id', 'desc');
}

export function findGitPushToolMessageRow(rows, requestId) {
  if (!requestId) return null;
  for (const row of rows) {
    let payload;
    try {
      payload = JSON.parse(row.message_json || '{}');
    } catch {
      continue;
    }
    if (!isGitPushToolPayload(payload)) continue;
    const parsed = parseMcpJsonResult(payload.result);
    if (parsed?.request_id === requestId) return { row, payload };
  }
  return null;
}

function mergeApprovalIntoMcpContent(contentText, patch) {
  if (typeof contentText !== 'string' || !contentText.trim().startsWith('{')) return contentText;
  try {
    const parsed = JSON.parse(contentText);
    if (!parsed || typeof parsed !== 'object') return contentText;
    return JSON.stringify({ ...parsed, ...patch }, null, 2);
  } catch {
    return contentText;
  }
}

/**
 * Persist GitPush approval resolution on the stored MCP tool_call row so chat
 * cards survive remount. Idempotent when approval_outcome is already set.
 */
export async function persistGitPushApprovalOutcome(
  app,
  session,
  { requestId, outcome, errorMessage }
) {
  if (!session?.id || !requestId || !GIT_PUSH_OUTCOMES.has(outcome)) return { patched: false };

  const db = app.get('db');
  const rows = await loadGitPushToolCallRowsForRequest(db, session.id, requestId);

  const match = findGitPushToolMessageRow(rows, requestId);
  if (!match) return { patched: false };

  const { row, payload } = match;
  const prevData = gitPushResultData(payload) ?? {};
  if (prevData.approval_outcome === outcome && prevData.approval_requested === false) {
    return { patched: false, message_id: row.id };
  }

  const dataPatch = {
    approval_requested: false,
    approval_outcome: outcome,
  };
  if (outcome === 'failed' && errorMessage) {
    dataPatch.error = errorMessage;
    dataPatch.ok = false;
  }
  if (outcome === 'pushed') {
    dataPatch.ok = true;
  }

  const nextData = { ...prevData, ...dataPatch };
  const prevResult = payload.result ?? {};
  const nextContent = mergeApprovalIntoMcpContent(prevResult.content, dataPatch);
  const nextPayload = {
    ...payload,
    result: {
      ...prevResult,
      content: nextContent,
      data: nextData,
    },
  };

  await app
    .service('messages')
    .patch(
      row.id,
      { message_json: JSON.stringify(nextPayload) },
      { provider: undefined, user: { id: session.user_id } }
    );

  let agent_notify = { delivered: false };
  try {
    agent_notify = await deliverGitPushOutcomeToAgent(app, session, {
      row,
      prevData: { ...gitPushPrevDataFromToolPayload(payload), ...dataPatch },
      outcome,
      errorMessage: errorMessage ?? null,
    });
  } catch (err) {
    agent_notify = { delivered: false, error: err?.message };
  }

  return { patched: true, message_id: row.id, agent_notify };
}

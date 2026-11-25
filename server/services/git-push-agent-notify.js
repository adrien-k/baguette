import logger from '../logger.js';
import { builderChatActiveKey, getAgentById } from './agents-db.js';
import { reviewTurnKey } from './review-agent-turn.js';
import { servicePathForSdk } from '../agent-sdks/registry.js';
import { ensureBuiltInSdkPluginsRegistered } from '../agent-sdks/ensure-builtins-registered.js';
import {
  sessionMessageIdentity,
  buildGitPushOutcomeMessageJson,
} from './feathers/message-create-fields.js';
import { parseMcpJsonResult } from '../../shared/parse-mcp-json-result.js';

/**
 * Agent-facing text when a GitPush approval modal resolves (pushed / canceled / failed).
 * @param {object} opts
 */
export function buildGitPushOutcomeAgentText({ outcome, prevData, errorMessage }) {
  const requestId =
    typeof prevData?.request_id === 'string' && prevData.request_id ? prevData.request_id : null;
  const target =
    typeof prevData?.target_branch === 'string' && prevData.target_branch
      ? prevData.target_branch
      : null;
  const source =
    typeof prevData?.source_branch === 'string' && prevData.source_branch
      ? prevData.source_branch
      : null;
  const force = prevData?.force === 'lease' || prevData?.force === 'force' ? prevData.force : null;

  const lines = ['GitPush approval resolved.', `Outcome: ${outcome}.`];
  if (requestId) lines.push(`request_id: ${requestId}`);
  if (source && target) lines.push(`Refs: ${source} → origin/${target}`);
  else if (target) lines.push(`Target: origin/${target}`);
  if (force) lines.push(`Force mode: ${force}`);

  if (outcome === 'pushed') {
    lines.push(
      '',
      'The user approved the push and it completed successfully. Do not call GitPush again for the same work unless something new needs publishing.'
    );
    return lines.join('\n');
  }

  if (outcome === 'canceled') {
    lines.push(
      '',
      'The user rejected the push request in the approval modal. No commits were published. Do not retry GitPush unless the user asks again.'
    );
    return lines.join('\n');
  }

  const err =
    (typeof errorMessage === 'string' && errorMessage.trim()) ||
    (typeof prevData?.error === 'string' && prevData.error.trim()) ||
    'Push failed (no error message was recorded).';
  lines.push(
    '',
    'The user approved the push in the modal, but the push failed.',
    '',
    'Error details:',
    err
  );
  return lines.join('\n');
}

async function resolveActiveAgentSessionState(app, agent) {
  if (!agent?.agent_sdk) return null;
  let path = servicePathForSdk(agent.agent_sdk);
  if (!path) {
    await ensureBuiltInSdkPluginsRegistered();
    path = servicePathForSdk(agent.agent_sdk);
  }
  if (!path) return null;
  let agentService = null;
  try {
    agentService = app.service(path);
  } catch {
    return null;
  }
  if (!agentService?.getActiveSession) return null;
  const key =
    agent.agent_type === 'reviewer' ? reviewTurnKey(agent.id) : builderChatActiveKey(agent);
  return agentService.getActiveSession(key) ?? null;
}

/**
 * Post a user message that starts the next agent turn after GitPush approval resolves.
 * @param {import('feathers').Application} app
 * @param {{ id: number; user_id: number }} session
 * @param {{ row: object; prevData: Record<string, unknown>; outcome: string; errorMessage?: string | null }} opts
 */
export async function deliverGitPushOutcomeToAgent(
  app,
  session,
  { row, prevData, outcome, errorMessage }
) {
  if (!session?.id || !row?.agent_id) return { delivered: false };

  const db = app.get('db');
  const agent = await getAgentById(db, row.agent_id);
  if (!agent || agent.session_id !== session.id) return { delivered: false };

  const content = buildGitPushOutcomeAgentText({ outcome, prevData, errorMessage });
  const message_json = buildGitPushOutcomeMessageJson(content, {
    outcome,
    request_id: prevData?.request_id ?? null,
    target_branch: prevData?.target_branch ?? null,
    source_branch: prevData?.source_branch ?? null,
    force: prevData?.force ?? null,
    ok: outcome === 'pushed',
    ...(outcome === 'failed' && errorMessage ? { error: errorMessage } : {}),
  });

  try {
    const activeState = await resolveActiveAgentSessionState(app, agent);
    if (agent.active_turn_id != null || activeState != null) {
      await app.service('queued-messages').create(
        {
          session_id: session.id,
          message_json,
          kind: 'turn',
          ...sessionMessageIdentity(agent),
        },
        { user: { id: session.user_id } }
      );
      return { delivered: true, queued: true };
    }

    await app.service('messages').create(
      {
        session_id: session.id,
        type: 'user',
        subtype: 'git_push_outcome',
        message_json,
        ...sessionMessageIdentity(agent),
      },
      { provider: undefined, user: { id: session.user_id } }
    );
    return { delivered: true };
  } catch (err) {
    logger.warn(
      { err: err?.message, sessionId: session.id, agentId: row.agent_id, outcome },
      'Failed to deliver GitPush outcome message to agent'
    );
    return { delivered: false, error: err?.message };
  }
}

/** @param {unknown} payload */
export function gitPushPrevDataFromToolPayload(payload) {
  const data = payload?.result?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return parseMcpJsonResult(data) ?? data;
  }
  return parseMcpJsonResult(payload?.result) ?? {};
}

import {
  isBaguetteUserMessage,
  isHumanUserMessage,
  resolveTurnModel,
} from '../../shared/turn-model.js';
import { normalizeUserPayloadForStorage } from '../../shared/normalize-user-payload.js';
import {
  agentSdkContextForSession,
  agentServicePathForSdk,
} from './agent-sdk/default-agent-sdk.js';
import { persistTypedMessage } from './message-writer-factory.ts';

/**
 * @param {object} row - DB message row
 */
export function parseUserRow(row) {
  try {
    return normalizeUserPayloadForStorage(JSON.parse(row.message_json || '{}'));
  } catch {
    return null;
  }
}

export function channelFromAgentType(agentType) {
  return agentType === 'reviewer' ? 'review' : 'chat';
}

/**
 * Route a persisted user row to agent services (each ignores non-matching SDK).
 * @param {import('@feathersjs/feathers').Application} app
 * @param {object} row
 * @param {'messages' | 'session-review-messages'} table
 */
export async function dispatchCreatedMessageToAgents(app, row, table) {
  if (row.type !== 'user') return;
  const session = await app.get('db')('sessions').where({ id: row.session_id }).first();
  if (!session) return;
  const sdk =
    table === 'session-review-messages'
      ? (session.review_agent_sdk ?? session.agent_sdk)
      : session.agent_sdk;
  const ctx = await agentSdkContextForSession(app, session);
  const servicePath = await agentServicePathForSdk(app, sdk, ctx);
  const agent = app.service(servicePath);
  if (agent?.handleTableMessageCreated) {
    await agent.handleTableMessageCreated(row, table);
  }
}

/**
 * Shared turn-id validation and reject system message.
 *
 * @param {import('./feathers/agent-service-types.ts').AgentApp} app
 */
export async function rejectTurnMismatch(app, { session, row, channel, activeTurnId, userId }) {
  const text =
    `Cannot accept message for turn ${row.turn_id}: agent is still processing turn ${activeTurnId}. ` +
    'Wait for the current turn to finish or stop the session.';
  const { model, modelParams } = resolveTurnModel(row, session);
  await persistTypedMessage(
    app,
    {
      sessionId: session.id,
      userId,
      turnId: row.turn_id,
      channel,
      agentSdk: row.agent_sdk ?? undefined,
      model: model ?? session.model,
      modelParams,
    },
    {
      type: 'system',
      subtype: 'status',
      status: text,
    }
  );
}

/**
 * @param {object} parsed
 */
export function isDispatchableUserMessage(parsed) {
  return isHumanUserMessage(parsed) || isBaguetteUserMessage(parsed);
}

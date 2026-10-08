import {
  isBaguetteUserMessage,
  isHumanUserMessage,
  resolveTurnModel,
} from '../../shared/turn-model.js';
import { normalizeUserPayloadForStorage } from '../../shared/normalize-user-payload.js';
import { getAgentServiceForSession } from './agent-session-routing.js';
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
 * Route a persisted user row to the SDK service for this session's agent config.
 * @param {import('@feathersjs/feathers').Application} app
 * @param {object} row
 * @param {'messages' | 'session-review-messages'} table
 */
export async function dispatchCreatedMessageToAgents(app, row, table) {
  if (row.type !== 'user') return;
  const session = await app.get('db')('sessions').where({ id: row.session_id }).first();
  if (!session) return;
  const review = table === 'session-review-messages' || row.agent_type === 'reviewer';
  const agent = await getAgentServiceForSession(app, session, { review });
  if (typeof agent?.handleMessageCreated === 'function') {
    await agent.handleMessageCreated(row);
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

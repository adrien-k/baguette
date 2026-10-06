import {
  isBaguetteUserMessage,
  isHumanUserMessage,
  resolveTurnModel,
} from '../../shared/turn-model.js';
import { normalizeUserPayloadForStorage } from '../../shared/normalize-user-payload.js';
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

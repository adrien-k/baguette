import { prepareAgentTurnCompaction } from './agent-turn-compaction.js';
import { ensureAgentChatSystemPromptMessage } from './ensure-agent-system-prompt-message.js';

/**
 * Shared turn start for every agent SDK: compact oversized tools, then persist
 * the chat system-prompt block once per agent (idempotent). Review turns skip
 * chat prompt persistence — {@link ReviewAgentTurn._prepareReviewPrompt} handles
 * the reviewer prompt.
 *
 * @param {import('feathers').Application} app
 * @param {object} session
 * @param {object | null | undefined} agent
 * @param {{ channel?: string; agentSdk?: string | null }} [opts]
 */
export async function prepareAgentTurnStart(app, session, agent, { channel, agentSdk } = {}) {
  await prepareAgentTurnCompaction(app, session);
  if (channel === 'review' || !agent?.id) return;
  const sdk = agentSdk ?? agent.agent_sdk ?? null;
  await ensureAgentChatSystemPromptMessage(app, session, agent, sdk);
}

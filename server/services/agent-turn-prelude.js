import { Forbidden } from 'feathers/errors';
import { getSdkPlugin } from '../agent-sdks/registry.js';
import { loadOwnedAgentConfigDecrypted } from './agent-context.js';
import { prepareAgentTurnCompaction } from './agent-turn-compaction.js';
import { ensureAgentChatSystemPromptMessage } from './ensure-agent-system-prompt-message.js';

export const NON_OWNER_MISSING_API_KEY_ERROR =
  'An API key is required to start a turn. Only the instance owner can use default system authentication.';

/**
 * Enforce that non-owners cannot start a turn using default system authentication
 * (i.e. an agent_config without an API key) for SDKs that require an API key.
 *
 * @param {import('feathers').Application} app
 * @param {{ userId: number; agentSdk?: string | null; agentConfigId?: number | null }} opts
 */
export async function assertAgentTurnCredentials(app, { userId, agentSdk, agentConfigId }) {
  const plugin = getSdkPlugin(agentSdk);
  if (plugin?.ownerOnlySystemAuth === false) return;

  const db = app.get('db');
  const user =
    userId != null ? await db('users').where({ id: userId }).select('id', 'owner').first() : null;
  if (user?.owner) return;

  const config = await loadOwnedAgentConfigDecrypted(agentConfigId, userId, db);
  const hasApiKey = typeof config?.api_key === 'string' && config.api_key.trim().length > 0;
  if (!hasApiKey) {
    throw new Forbidden(NON_OWNER_MISSING_API_KEY_ERROR);
  }
}

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

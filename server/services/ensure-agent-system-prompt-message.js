import { sessionMessageIdentity } from './feathers/message-create-fields.js';

/**
 * @param {import('knex').Knex} db
 */
export async function agentHasSystemPromptMessage(db, sessionId, agentId) {
  if (!sessionId || !agentId) return false;
  const row = await db('session_messages')
    .where({
      session_id: sessionId,
      agent_id: agentId,
      type: 'system',
      subtype: 'prompt',
    })
    .first();
  return Boolean(row);
}

/**
 * Persist a collapsible system-prompt block for this agent's chat (idempotent).
 *
 * @param {import('feathers').Application} app
 * @param {object} session - session row
 * @param {object} agent - agents row
 * @param {string} content - full append prompt shown in the UI
 */
export async function ensureAgentSystemPromptMessage(app, session, agent, content) {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed || !agent?.id || !session?.id) return;

  const db = app.get('db');
  if (await agentHasSystemPromptMessage(db, session.id, agent.id)) return;

  await app.service('messages').create(
    {
      session_id: session.id,
      type: 'system',
      subtype: 'prompt',
      message_json: JSON.stringify({
        type: 'system',
        subtype: 'prompt',
        content: trimmed,
      }),
      ...sessionMessageIdentity(agent),
    },
    { provider: undefined, user: { id: session.user_id } }
  );
}

/**
 * Post a finished subagent's result back to its parent agent.
 *
 * `StartSubagent`'s `notify_parent` option promises the parent a wake-up when the
 * subagent's turn finishes: the server injects a user message to the parent with the
 * result summary. Use it when ending a turn while a detached subagent still runs —
 * the message starts (or queues) the parent's next turn. Skip it when the parent
 * will AwaitSubagent itself.
 */
import logger from '../logger.js';
import { getAgentById } from './agents-db.js';
import { sessionMessageIdentity } from './feathers/message-create-fields.js';
import { normalizeUserPayloadForStorage } from '../../shared/normalize-user-payload.js';

/** Plain-text summary of a subagent's last assistant message (null when none). */
function assistantSummaryText(row) {
  if (!row?.message_json) return null;
  try {
    const parsed = JSON.parse(row.message_json);
    const content = parsed?.message?.content ?? parsed?.content;
    if (typeof content === 'string') {
      const text = content.trim();
      return text || null;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n\n')
        .trim();
      return text || null;
    }
  } catch {
    // Malformed row — report the status without a summary.
  }
  return null;
}

function truncate(text, maxLen = 4000) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function buildNotifyContent(subagent, status, summary) {
  const label = subagent.ref != null ? `#${subagent.ref} "${subagent.name}"` : `"${subagent.name}"`;
  const lines = [`Subagent ${label} finished with status ${status}.`];
  if (summary) lines.push('', 'Last message:', '', truncate(summary));
  else lines.push('', 'No assistant message was recorded for the turn.');
  return lines.join('\n');
}

/**
 * Inject a `baguette` user message to the parent agent when a `notify_parent` subagent
 * finishes. Internal call — bypasses the subagent MCP-only guard (provider-less params)
 * and starts/queues the parent's next turn via the normal message dispatch path.
 *
 * @param {import('feathers').Application} app
 * @param {object} subagent - fresh `agents` row of the finished subagent
 * @param {number} userId - session owner id
 * @param {'completed' | 'failed'} status - terminal status of the subagent turn
 */
export async function notifyParentOfFinishedSubagent(app, subagent, userId, status) {
  if (!subagent?.parent_agent_id || !subagent.session_id) return;
  const db = app.get('db');
  const parent = await getAgentById(db, subagent.parent_agent_id);
  if (!parent || parent.session_id !== subagent.session_id) return;
  if (parent.agent_type !== 'builder' && parent.agent_type !== 'subagent') return;

  const lastAssistant = await db('session_messages')
    .where({ session_id: subagent.session_id, agent_id: subagent.id, type: 'assistant' })
    .orderBy('id', 'desc')
    .first();
  const summary = assistantSummaryText(lastAssistant);
  const content = buildNotifyContent(subagent, status, summary);
  const payload = normalizeUserPayloadForStorage({
    type: 'user',
    source: 'baguette',
    title: `Subagent ${subagent.name} finished`,
    message: { role: 'user', content },
  });

  await app.service('messages').create(
    {
      session_id: subagent.session_id,
      type: 'user',
      subtype: 'baguette',
      message_json: JSON.stringify(payload),
      ...sessionMessageIdentity(parent),
    },
    { provider: undefined, user: { id: userId } }
  );
  logger.info(
    { sessionId: subagent.session_id, subagentId: subagent.id, parentId: parent.id, status },
    'Posted subagent result to parent agent'
  );
}

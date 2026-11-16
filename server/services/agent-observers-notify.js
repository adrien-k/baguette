/**
 * Wake up every observer of an agent when its turn reaches a notable state.
 *
 * `agent_observers` rows unify the two wake-up scenarios:
 * - a subagent whose parent used StartSubagent `notify_parent: true` (same-session pair)
 * - a cross-session watch (session A's primary agent observing session B's primary agent)
 *
 * The server injects a `baguette` user message per observer agent — starting (or queueing)
 * the observer's next turn — with the observed agent's terminal status and a summary of its
 * last assistant message. `notify_on: 'once'` rows are consumed by the first notification.
 */
import logger from '../logger.js';
import { normalizeUserPayloadForStorage } from '../../shared/normalize-user-payload.js';
import { sessionMessageIdentity } from './feathers/message-create-fields.js';

/** Plain-text summary of the observed agent's last assistant message (null when none). */
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

/** Message-title label (kept identical to the pre-observer subagent notify titles). */
function observedTitleLabel(observedAgent, observedSession) {
  if (observedAgent.agent_type === 'subagent') {
    return `Subagent ${observedAgent.name}`;
  }
  return `Session "${observedSession?.label ?? ''}"`;
}

/** Content label with ref / session id for disambiguation. */
function observedLabel(observedAgent, observedSession) {
  if (observedAgent.agent_type === 'subagent') {
    const ref = observedAgent.ref != null ? `#${observedAgent.ref} ` : '';
    return `Subagent ${ref}"${observedAgent.name}"`;
  }
  const label = observedSession?.label ? ` "${observedSession.label}"` : '';
  const id = observedSession?.id != null ? ` (#${observedSession.id})` : '';
  return `Session${label}${id}`;
}

function buildNotifyContent(
  observedAgent,
  observedSession,
  { status, awaitingUser, summary, queued }
) {
  const label = observedLabel(observedAgent, observedSession);
  if (awaitingUser) {
    const lines = [`${label} is waiting for user input.`];
    if (observedAgent.agent_type !== 'subagent')
      lines.push(`See /sessions/${observedSession?.id}.`);
    if (summary) lines.push('', 'Last message:', '', truncate(summary));
    return lines.join('\n');
  }
  const lines = [`${label} finished with status ${status}.`];
  if (observedAgent.agent_type !== 'subagent') {
    lines.push(`See /sessions/${observedSession?.id}.`);
  }
  if (summary) lines.push('', 'Last message:', '', truncate(summary));
  else lines.push('', 'No assistant message was recorded for the turn.');
  if (queued > 0) {
    lines.push(
      '',
      `There ${queued === 1 ? 'is 1 queued message' : `are ${queued} queued messages`} for this agent.`
    );
  }
  return lines.join('\n');
}

function buildNotifyTitle(observedAgent, observedSession, { awaitingUser }) {
  const label = observedTitleLabel(observedAgent, observedSession);
  if (awaitingUser) return `${label} is waiting for user input`;
  return `${label} finished`;
}

/** Live (non-archived-session) observers of an agent row. */
async function listAgentObservers(db, agentId) {
  return db('agent_observers as ao')
    .join('agents as oa', 'oa.id', 'ao.observer_agent_id')
    .join('sessions as os', 'os.id', 'oa.session_id')
    .where('ao.agent_id', agentId)
    .whereNull('os.archived_at')
    .select('ao.id as observer_row_id', 'ao.notify_on', 'oa.*');
}

/** Count queued turn messages for an agent (used in wake-up content). */
async function countQueuedTurnMessages(db, agentId) {
  const row = await db('queued_messages')
    .where({ agent_id: agentId, kind: 'turn' })
    .count('id as count')
    .first();
  return Number(row?.count ?? 0);
}

/**
 * Inject a `baguette` user message into every observer session. Internal call —
 * bypasses subagent MCP-only guards (provider-less params) and starts/queues the
 * observer's next turn via the normal message dispatch path.
 *
 * @param {import('feathers').Application} app
 * @param {object} observedAgent - `agents` row whose turn reached a notable state
 * @param {number} userId - owner id of the observed session (message author)
 * @param {{ status?: 'completed' | 'failed', awaitingUser?: boolean }} opts
 */
export async function notifyAgentObservers(
  app,
  observedAgent,
  userId,
  { status, awaitingUser = false } = {}
) {
  if (!observedAgent?.id || (!status && !awaitingUser)) return;
  const db = app.get('db');
  // Defense in depth: a self-observer row (agent watching its own turns) would
  // re-trigger itself forever — insertAgentObserver rejects them, but skip any
  // legacy row too.
  const observers = (await listAgentObservers(db, observedAgent.id)).filter(
    (row) => row.id !== observedAgent.id
  );
  if (!observers.length) return;

  const observedSession = await db('sessions').where({ id: observedAgent.session_id }).first();
  if (!observedSession || observedSession.archived_at) return;

  const lastAssistant = await db('session_messages')
    .where({ session_id: observedAgent.session_id, agent_id: observedAgent.id, type: 'assistant' })
    .orderBy('id', 'desc')
    .first();
  const summary = assistantSummaryText(lastAssistant);
  const queued = await countQueuedTurnMessages(db, observedAgent.id);

  // One failing observer must not abort the whole fan-out or block the rest:
  // deliver each wake-up independently and keep going.
  let delivered = 0;
  const deliveredOnceRowIds = [];
  for (const observer of observers) {
    try {
      const content = buildNotifyContent(observedAgent, observedSession, {
        status,
        awaitingUser,
        summary,
        queued,
      });
      const payload = normalizeUserPayloadForStorage({
        type: 'user',
        source: 'baguette',
        title: buildNotifyTitle(observedAgent, observedSession, { awaitingUser }),
        message: { role: 'user', content },
      });

      await app.service('messages').create(
        {
          session_id: observer.session_id,
          type: 'user',
          subtype: 'baguette',
          message_json: JSON.stringify(payload),
          ...sessionMessageIdentity(observer),
        },
        { provider: undefined, user: { id: userId } }
      );
      delivered += 1;
      if (observer.notify_on === 'once') deliveredOnceRowIds.push(observer.observer_row_id);
    } catch (err) {
      logger.warn(
        {
          observedAgentId: observedAgent.id,
          observerAgentId: observer.id,
          observerSessionId: observer.session_id,
          err: err?.message,
        },
        'Failed to deliver agent observer wake-up — skipping this observer'
      );
    }
  }

  // `notify_on: 'once'` rows are consumed by their first *delivered* notification:
  // a failed delivery keeps its row so the next notable transition retries, and the
  // observer still gets exactly one ping.
  if (deliveredOnceRowIds.length) {
    try {
      await db('agent_observers')
        .where({ agent_id: observedAgent.id, notify_on: 'once' })
        .whereIn('id', deliveredOnceRowIds)
        .delete();
    } catch (err) {
      logger.warn(
        { agentId: observedAgent.id, err: err?.message },
        'Failed to consume delivered once observer rows'
      );
    }
  }

  logger.info(
    { agentId: observedAgent.id, observers: observers.length, delivered, status, awaitingUser },
    'Notified agent observers of turn state'
  );
}

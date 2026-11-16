import { z } from 'zod';
import {
  MCP_AWAIT_TIMEOUT_MS,
  mcpAwaitTimeoutMinutes,
} from '../../../../shared/mcp-await-timeout.js';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById, summarizeAssistantMessage } from '../lib/session-resolution.js';
import { getPrimaryBuilderAgent, notifyParentAgentIds } from '../../agents-db.js';
import { waitForAgentTurnEnd } from '../../wait-for-agent-turn.js';

function sessionTurnWaitTimeoutMessage(session, agent) {
  const label = session?.label ? ` "${session.label}"` : '';
  const ref = agent?.ref != null ? ` (agent ref ${agent.ref})` : '';
  const minutes = mcpAwaitTimeoutMinutes();
  return (
    `Timed out after ${minutes} minutes waiting for session${label} #${session?.id ?? ''}${ref} to finish its turn. ` +
    'The turn was not cancelled — it keeps running in the background. ' +
    'Check GetSessionStatus for progress, then call AwaitSessionTurn again to continue waiting.'
  );
}

export function createAwaitSessionTurnTool(ctx) {
  const { app, userId } = ctx;
  const waitMinutes = mcpAwaitTimeoutMinutes();
  return {
    name: 'AwaitSessionTurn',
    description:
      `Block until a session's primary builder turn finishes (up to ${waitMinutes} minutes per call), then return its status and last assistant message. ` +
      'On timeout the turn is NOT cancelled — the wait is virtually detached and it keeps running: check GetSessionStatus for progress, then AwaitSessionTurn again to continue waiting. ' +
      'Blocking prevents taking new user messages during the wait — for long work prefer CreateSession(notify_parent: true) or WatchSession wake-ups instead, and keep this for short synchronous waits. ' +
      'Identify the session by session_id (from SearchSessions or CreateSession).',
    schema: {
      session_id: z.number().int().describe('Session numeric id'),
    },
    handler: async ({ session_id }) => {
      if (session_id == null) {
        return fail('Provide session_id');
      }
      const { session, error } = await requireOwnedSessionById(app, session_id, userId);
      if (!session) return fail(error);
      const db = app.get('db');
      const builder = await getPrimaryBuilderAgent(db, session.id);
      if (!builder) return fail('Session has no primary builder');

      let timedOut = false;
      if (builder.status === 'running') {
        try {
          await waitForAgentTurnEnd(db, builder.id, {
            timeoutMs: MCP_AWAIT_TIMEOUT_MS,
            timeoutMessage: (agent) => sessionTurnWaitTimeoutMessage(session, agent),
          });
        } catch (err) {
          if (!err.isTurnWaitTimeout) return fail(err.message);
          timedOut = true;
        }
      }

      const fresh = await getPrimaryBuilderAgent(db, session.id);
      const lastAssistant = await db('session_messages')
        .where({ session_id: session.id, agent_id: builder.id, type: 'assistant' })
        .orderBy('id', 'desc')
        .first();
      const queuedRow = await db('queued_messages')
        .where({ agent_id: builder.id, kind: 'turn' })
        .count('id as count')
        .first();
      const watching = await notifyParentAgentIds(db, [builder.id]);
      return ok({
        session_id: session.id,
        agent_id: builder.id,
        status: fresh?.status ?? builder.status,
        timed_out: timedOut,
        last_assistant_message: summarizeAssistantMessage(lastAssistant),
        queued_message_count: Number(queuedRow?.count ?? 0),
        notify_watched: watching.has(builder.id),
      });
    },
  };
}

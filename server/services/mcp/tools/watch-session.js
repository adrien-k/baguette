import { z } from 'zod';
import { isGlobalSession } from '../../../../shared/session-scope.js';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById, summarizeAssistantMessage } from '../lib/session-resolution.js';
import { getPrimaryBuilderAgent } from '../../agents-db.js';

export function createWatchSessionTool(ctx) {
  const { app, userId, userParams, callerSession, callerAgent } = ctx;
  return {
    name: 'WatchSession',
    description:
      'Subscribe this agent to a session’s turn-end notifications (idempotent — re-watching is a no-op). ' +
      'When the watched session’s primary builder turn finishes (completed/failed) or waits for user input (approval), ' +
      'Baguette posts a summary to you as a new user message. ' +
      'Set `notify_on: "once"` for a single notification; default keeps watching every turn. ' +
      'The result reports the observed agent’s current status: notifications only fire on future transitions, so if a turn already finished (or the agent is waiting on user input) when you subscribe, handle that state right away from the result. ' +
      'Watches that would create a wake-up loop are rejected — you cannot watch your own session, and mutual or transitive watch cycles are refused because each wake-up starts a real turn. ' +
      'Only global sessions can observe other sessions — a repo session cannot watch the sessions it creates; supervision belongs to a global orchestrator. ' +
      'Unsubscribe with UnwatchSession. CreateSession(notify_parent: true) already watches the new session.',
    schema: {
      session_id: z.number().int().describe('Session numeric id to watch'),
      notify_on: z
        .enum(['turn_end', 'once'])
        .optional()
        .describe('turn_end (default) = notify on every turn end; once = notify a single time'),
    },
    handler: async ({ session_id, notify_on }) => {
      if (session_id == null) return fail('Provide session_id');
      if (callerSession?.id == null || callerAgent?.id == null) {
        return fail(
          'Watching requires an in-session agent (caller session and agent); external MCP callers cannot receive wake-ups.'
        );
      }
      if (!isGlobalSession(callerSession)) {
        return fail(
          'Only global sessions can observe other sessions — session watching is the global orchestrator workflow. ' +
            'A repo session cannot watch the sessions it creates; create them without notify_parent, or run the orchestration from a global session.'
        );
      }
      const { error } = await requireOwnedSessionById(app, session_id, userId);
      if (error) return fail(error);
      try {
        const result = await app.service('agent-observers').watch(
          {
            session_id,
            observer_session_id: callerSession.id,
            observer_agent_id: callerAgent.id,
            ...(notify_on ? { notify_on } : {}),
          },
          userParams
        );

        // Wake-ups fire on transitions only — surface the observed agent's current
        // state so a turn that ended between the caller's decision and this call
        // (or an agent already waiting on user input) is not silently missed.
        const db = app.get('db');
        const builder = await getPrimaryBuilderAgent(db, session_id);
        let current = null;
        if (builder) {
          const lastAssistant = await db('session_messages')
            .where({ session_id, agent_id: builder.id, type: 'assistant' })
            .orderBy('id', 'desc')
            .first();
          const queuedRow = await db('queued_messages')
            .where({ agent_id: builder.id, kind: 'turn' })
            .count('id as count')
            .first();
          current = {
            status: builder.status,
            last_assistant_message: summarizeAssistantMessage(lastAssistant),
            queued_message_count: Number(queuedRow?.count ?? 0),
          };
        }
        return ok({ ...result, observed: current });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

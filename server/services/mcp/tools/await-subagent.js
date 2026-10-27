import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { resolveSubagentInSession } from '../lib/subagent-resolution.js';

export function createAwaitSubagentTool(ctx) {
  const { app, userId, userParams, callerSession } = ctx;
  return {
    name: 'AwaitSubagent',
    description:
      'Block until a subagent turn finishes (up to 1 hour per call), then return status and the last assistant message. ' +
      'On timeout the subagent may still be running: read its last assistant message (GetSessionMessages), then AwaitSubagent again or StopSubagent. ' +
      'Use after StartSubagent with attach: false or to wait on a subagent started earlier. ' +
      'Identify the subagent by agent_id or agent_ref from ListSubagents / StartSubagent.',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Session id (default: current session when running in a repo session)'),
      agent_id: z.number().int().optional().describe('Subagent database id'),
      agent_ref: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Session-relative agent ref from ListSubagents'),
    },
    handler: async ({ session_id, agent_id, agent_ref }) => {
      let targetSessionId = callerSession?.id ?? null;
      if (session_id != null) {
        const { session, error } = await requireOwnedSessionById(app, session_id, userId);
        if (error) return fail(error);
        targetSessionId = session.id;
      }
      if (targetSessionId == null) {
        return fail('Provide session_id');
      }
      if (agent_id == null && agent_ref == null) {
        return fail('agent_id or agent_ref is required');
      }
      const db = app.get('db');
      const agent = await resolveSubagentInSession(db, targetSessionId, {
        agent_id,
        agent_ref,
      });
      if (!agent) return fail('Subagent not found');
      try {
        const result = await app.service('agents').awaitSubagent(
          {
            session_id: targetSessionId,
            agent_id: agent.id,
          },
          userParams
        );
        return ok(result);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

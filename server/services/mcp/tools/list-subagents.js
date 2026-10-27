import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';

const SUBAGENT_STATUS = z.enum(['running', 'approval', 'completed', 'failed', 'stopped']);

export function createListSubagentsTool(ctx) {
  const { app, userId, userParams, callerSession } = ctx;
  return {
    name: 'ListSubagents',
    description:
      'List MCP subagents (`agent_type` subagent) in a session with optional status filtering. ' +
      'Omit session_id in a repo session for the current session. ' +
      'Use with AwaitSubagent, StopSubagent, and CreateSessionMessage (agent_ref).',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Session id (default: current session when running in a repo session)'),
      status: SUBAGENT_STATUS.optional().describe('Return only subagents with this status'),
      active_only: z
        .boolean()
        .optional()
        .describe('If true, only subagents that are running or awaiting approval'),
    },
    handler: async ({ session_id, status, active_only }) => {
      let targetSessionId = callerSession?.id ?? null;
      if (session_id != null) {
        const { session, error } = await requireOwnedSessionById(app, session_id, userId);
        if (error) return fail(error);
        targetSessionId = session.id;
      }
      if (targetSessionId == null) {
        return fail('Provide session_id');
      }
      if (status != null && active_only) {
        return fail('Pass status or active_only, not both');
      }
      try {
        const result = await app.service('agents').listSubagents(
          {
            session_id: targetSessionId,
            ...(status != null ? { status } : {}),
            ...(active_only === true ? { active_only: true } : {}),
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

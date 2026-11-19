import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { SESSION_AGENT_TYPES } from '../../agents-db.js';

const AGENT_STATUS = z.enum(['running', 'approval', 'completed', 'failed', 'stopped']);
const AGENT_TYPE = z.enum(['builder', 'reviewer', 'subagent']);

export function createListAgentsTool(ctx) {
  const { app, userId, userParams, callerSession } = ctx;
  return {
    name: 'ListAgents',
    description:
      'List session agents with optional filters. Pass `agent_types` (builder, reviewer, subagent) to limit results — ' +
      'omit it to include all types (e.g. `["reviewer"]` to see whether a review is running). ' +
      'Each row includes status and error_message when failed. Subagent rows also include notify_parent and isolated worktree fields. ' +
      'Omit session_id in a repo session for the current session. ' +
      'Use with AwaitAgent / StopSubagent and CreateSessionMessage (agent_ref).',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Session id (default: current session when running in a repo session)'),
      agent_types: z
        .array(AGENT_TYPE)
        .optional()
        .describe(`Agent types to include (default: all of ${SESSION_AGENT_TYPES.join(', ')})`),
      status: AGENT_STATUS.optional().describe('Return only agents with this status'),
      active_only: z
        .boolean()
        .optional()
        .describe('If true, only agents that are running or awaiting approval'),
    },
    handler: async ({ session_id, agent_types, status, active_only }) => {
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
        const result = await app.service('agents').listAgents(
          {
            session_id: targetSessionId,
            ...(agent_types != null ? { agent_types } : {}),
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

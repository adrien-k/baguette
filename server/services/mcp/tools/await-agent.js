import { z } from 'zod';
import { mcpAwaitTimeoutMinutes } from '../../../../shared/mcp-await-timeout.js';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { resolveAgentInSession } from '../lib/subagent-resolution.js';

export function createAwaitAgentTool(ctx) {
  const { app, userId, callerSession } = ctx;
  const userParams = ctx.userParams ?? { provider: 'rest', user: { id: userId } };
  const waitMinutes = mcpAwaitTimeoutMinutes();
  return {
    name: 'AwaitAgent',
    description:
      `Block until an agent turn finishes (up to ${waitMinutes} minutes per call), then return status, error_message when failed, and the last assistant message. ` +
      'On timeout the agent is NOT cancelled — the wait is virtually detached and the turn keeps running: read its last assistant message (GetAgentMessages) to check progress, then call AwaitAgent again to continue waiting, or StopSubagent only if it looks stuck for no good reason. ' +
      'Use after StartSubagent with attach: false, StartReview / ContinueReview (reviewer), or to wait on any session agent started earlier. ' +
      'Identify the agent by agent_id or agent_ref from ListAgents.',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Session id (default: current session when running in a repo session)'),
      agent_id: z.number().int().optional().describe('Agent database id'),
      agent_ref: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Session-relative agent ref from ListAgents'),
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
      const agent = await resolveAgentInSession(db, targetSessionId, {
        agent_id,
        agent_ref,
      });
      if (!agent) return fail('Agent not found');
      try {
        const result = await app.service('agents').awaitAgent(
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

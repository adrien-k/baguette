import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { resolveSubagentInSession, formatSubagentSummary } from '../lib/subagent-resolution.js';

export function createStopSubagentTool(ctx) {
  const { app, userId, userParams, callerSession } = ctx;
  return {
    name: 'StopSubagent',
    description:
      'Stop a running subagent turn (and any active child subagents it spawned). ' +
      'Use when a subagent is stuck or after AwaitSubagent times out with no progress (GetSessionMessages first). ' +
      'Identify the subagent by agent_id or agent_ref from ListSubagents.',
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
        await app.service('agents').stop({ agent_id: agent.id }, userParams);
        const fresh = await resolveSubagentInSession(db, targetSessionId, { agent_id: agent.id });
        return ok({
          stopped: true,
          subagent: formatSubagentSummary(fresh),
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

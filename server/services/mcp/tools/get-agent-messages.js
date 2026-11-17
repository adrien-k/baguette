import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { packSessionMessagesForMcp, MCP_MESSAGES_PAGE_SIZE } from '../../baguette-mcp-payload.js';
import { getAgentById, getPrimaryBuilderAgent } from '../../agents-db.js';

export function createGetAgentMessagesTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'GetAgentMessages',
    description:
      'List messages for one agent in a session (paginated, 50 per page). Thinking blocks are omitted from assistant messages. ' +
      "Omit agent_id (or pass null) to read the session's primary builder. " +
      'Pass afterMessage with the nextMessageId from the previous page to fetch the next page.',
    schema: {
      session_id: z.number().int().describe('Session numeric id'),
      agent_id: z
        .number()
        .int()
        .nullish()
        .describe('Agent database id. Omit or pass null for the primary builder'),
      types: z
        .array(z.enum(['user', 'assistant']))
        .optional()
        .describe('Filter by message types (default: user and assistant)'),
      afterMessage: z
        .number()
        .int()
        .optional()
        .describe('Return messages with id greater than this message id'),
    },
    handler: async (args) => {
      const { session_id, types, afterMessage, agent_id: agentIdArg } = args;
      const { error } = await requireOwnedSessionById(app, session_id, userId);
      if (error) return fail(error);

      const db = app.get('db');
      let agent;
      if (agentIdArg == null) {
        agent = await getPrimaryBuilderAgent(db, session_id);
        if (!agent) return fail('Session has no primary builder');
      } else {
        agent = await getAgentById(db, agentIdArg);
        if (!agent || agent.session_id !== session_id) return fail('Agent not found');
      }

      const typeFilter = types?.length ? types : ['user', 'assistant'];
      let query = db('session_messages')
        .where({ session_id, agent_id: agent.id })
        .whereIn('type', typeFilter)
        .orderBy('id', 'asc');

      if (afterMessage != null) query = query.where('id', '>', afterMessage);

      const rows = await query.limit(MCP_MESSAGES_PAGE_SIZE + 1);
      const hasMoreRows = rows.length > MCP_MESSAGES_PAGE_SIZE;
      const pageRows = hasMoreRows ? rows.slice(0, MCP_MESSAGES_PAGE_SIZE) : rows;
      const packed = packSessionMessagesForMcp(pageRows, { hasMoreRows });
      return ok({ session_id, agent_id: agent.id, ...packed });
    },
  };
}

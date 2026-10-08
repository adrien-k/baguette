import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { packSessionMessagesForMcp, MCP_MESSAGES_PAGE_SIZE } from '../../baguette-mcp-payload.js';

export function createGetSessionMessagesTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'GetSessionMessages',
    description:
      'List session messages (paginated, 50 per page). Thinking blocks are omitted from assistant messages. Pass afterMessage with the nextMessageId from the previous page to fetch the next page.',
    schema: {
      session_id: z.number().int().describe('Session numeric id'),
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
      const { session_id, types, afterMessage } = args;
      const { error } = await requireOwnedSessionById(app, session_id, userId);
      if (error) return fail(error);

      const typeFilter = types?.length ? types : ['user', 'assistant'];
      const db = app.get('db');
      let query = db('session_messages')
        .where({ session_id, agent_type: 'builder' })
        .whereIn('type', typeFilter)
        .orderBy('id', 'asc');

      if (afterMessage != null) query = query.where('id', '>', afterMessage);

      const rows = await query.limit(MCP_MESSAGES_PAGE_SIZE + 1);
      const hasMoreRows = rows.length > MCP_MESSAGES_PAGE_SIZE;
      const pageRows = hasMoreRows ? rows.slice(0, MCP_MESSAGES_PAGE_SIZE) : rows;
      const packed = packSessionMessagesForMcp(pageRows, { hasMoreRows });
      return ok({ session_id, ...packed });
    },
  };
}

import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { packSessionMessagesForMcp } from '../../baguette-mcp-payload.js';

export function createGetSessionMessagesTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'GetSessionMessages',
    description:
      'List session messages (paginated). Response JSON is capped at 5000 bytes; oversized bodies are truncated with a hint to use GetSessionMessage. Pass afterMessage with the last id from the previous page.',
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
        .where({ session_id })
        .whereIn('type', typeFilter)
        .orderBy('id', 'asc');

      if (afterMessage != null) query = query.where('id', '>', afterMessage);

      const rows = await query.limit(200);
      const packed = packSessionMessagesForMcp(rows, { afterMessage: afterMessage ?? null });
      return ok({ session_id, ...packed });
    },
  };
}

import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';
import { sliceByteRange, validateLogByteRange, DEFAULT_LOG_BYTES } from '../../mcp-pagination.js';

export function createGetSessionMessageTool(ctx) {
  const { app, userId } = ctx;
  return {
    name: 'GetSessionMessage',
    description: `Read a single message body (message_json) with optional byte range — same semantics as ReadTaskOutput / PrWorkflowLogs (default last ${DEFAULT_LOG_BYTES} bytes).`,
    schema: {
      session_id: z.number().int().describe('Session numeric id'),
      message_id: z.number().int(),
      startByte: z.number().optional(),
      endByte: z.number().optional(),
    },
    handler: async (args) => {
      const { message_id, startByte, endByte } = args;
      const validationError = validateLogByteRange({ startByte, endByte });
      if (validationError) return fail(validationError);

      const { session, error } = await requireOwnedSessionById(app, args.session_id, userId);
      if (error) return fail(error);
      const session_id = session.id;

      const db = app.get('db');
      const row = await db('session_messages').where({ id: message_id, session_id }).first();
      if (!row) return fail('Message not found');

      try {
        const {
          log,
          totalBytes,
          startByte: actualStart,
          endByte: actualEnd,
        } = sliceByteRange(row.message_json ?? '', { startByte, endByte });
        return ok({
          session_id,
          message_id,
          type: row.type,
          subtype: row.subtype ?? null,
          created_at: row.created_at,
          totalBytes,
          startByte: actualStart,
          endByte: actualEnd,
          message_json: log,
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

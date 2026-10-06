import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import {
  requireOwnedSessionById,
  buildMcpUserMessageJson,
  canPostToSession,
  crossSessionPostError,
} from '../lib/session-resolution.js';

export function createCreateSessionMessageTool(ctx) {
  const { app, userId, callerSession } = ctx;
  return {
    name: 'CreateSessionMessage',
    description:
      'IMPORTANT: Do not use this tool unless the user explicitly asks you to send or schedule a message to a session. ' +
      'Send a user message to a session now, or schedule it with send_at (ISO timestamp in the future). ' +
      'Repo session agents may only post to their own session_id; global session agents and external MCP may post to any of your sessions. ' +
      'Immediate sends while the agent is running are queued for the next turn, like the UI Send button.',
    schema: {
      session_id: z.number().int().describe('Target session id'),
      text: z.string().describe('User message text'),
      send_at: z
        .string()
        .optional()
        .describe('ISO timestamp — deliver at this time instead of sending immediately'),
      force: z
        .boolean()
        .optional()
        .describe(
          'When sending immediately: start a new turn even if the agent is already running'
        ),
    },
    handler: async (args) => {
      const { session_id, text, send_at, force } = args;
      const { error } = await requireOwnedSessionById(app, session_id, userId);
      if (error) return fail(error);
      if (!canPostToSession(callerSession, session_id)) {
        return fail(crossSessionPostError());
      }

      const message_json = buildMcpUserMessageJson(text);
      const userParams = { provider: 'rest', user: { id: userId } };

      if (send_at) {
        try {
          const row = await app
            .service('queued-messages')
            .schedule({ session_id, message_json, send_at }, { user: { id: userId } });
          return ok({
            scheduled: true,
            queued_message_id: row.id,
            send_at: row.send_at,
            session_id,
          });
        } catch (err) {
          return fail(err.message);
        }
      }

      try {
        const result = await app.service('messages').create(
          {
            session_id,
            type: 'user',
            subtype: 'mcp',
            message_json,
            ...(force ? { force: true } : {}),
          },
          userParams
        );
        if (result?.queued) {
          return ok({ queued: true, session_id });
        }
        return ok({ message_id: result.id, session_id });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

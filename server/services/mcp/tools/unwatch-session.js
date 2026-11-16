import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';

export function createUnwatchSessionTool(ctx) {
  const { app, userId, userParams, callerSession } = ctx;
  return {
    name: 'UnwatchSession',
    description:
      'Unsubscribe this session from a watched session’s turn-end notifications (removes every observer row your session holds for it). ' +
      'Pass the session_id you previously passed to WatchSession or created with CreateSession(notify_parent: true).',
    schema: {
      session_id: z.number().int().describe('Watched session numeric id'),
    },
    handler: async ({ session_id }) => {
      if (session_id == null) return fail('Provide session_id');
      if (callerSession?.id == null) {
        return fail(
          'Unwatching requires an in-session agent (caller session); external MCP callers cannot hold watches.'
        );
      }
      const { error } = await requireOwnedSessionById(app, session_id, userId);
      if (error) return fail(error);
      try {
        const result = await app.service('agent-observers').unwatch(
          {
            session_id,
            observer_session_id: callerSession.id,
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

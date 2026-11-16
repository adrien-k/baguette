import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireOwnedSessionById } from '../lib/session-resolution.js';

export function createStopSessionTool(ctx) {
  const { app, userId, userParams } = ctx;
  return {
    name: 'StopSession',
    description:
      'Stop a session’s running agent turn(s) (the primary builder and its subagents) without archiving. ' +
      'Use to stop a runaway or unneeded child session you are orchestrating; the user can always re-send a message later. ' +
      'Identify the session by session_id (from SearchSessions or CreateSession).',
    schema: {
      session_id: z.number().int().describe('Session numeric id'),
    },
    handler: async ({ session_id }) => {
      if (session_id == null) {
        return fail('Provide session_id');
      }
      const { session, error } = await requireOwnedSessionById(app, session_id, userId);
      if (!session) return fail(error);
      try {
        await app.service('sessions').stop(session.id, userParams);
        return ok({ stopped: true, session_id: session.id });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

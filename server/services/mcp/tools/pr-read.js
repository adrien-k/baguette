import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { resolveTargetSession } from '../lib/session-resolution.js';
import { readPrForSession } from '../lib/pr-read.js';
import { isGlobalSession } from '../../../../shared/session-scope.js';

export function createPrReadTool(ctx) {
  const { app, userId, callerSession } = ctx;
  return {
    name: 'PrRead',
    description:
      'Get pull request info (URL, number, branch, title, description) for a repo session. ' +
      'When running inside a repo session, omit session_id to read the current session. ' +
      'From a global session or when triaging another session, pass session_id (from GetSession or SearchSessions). ' +
      'Does not apply to global sessions.',
    schema: {
      session_id: z.number().int().optional().describe('Target repo session id'),
    },
    handler: async ({ session_id }) => {
      const session = await resolveTargetSession(app, session_id, userId, callerSession);
      if (!session) {
        return fail('Session not found. Provide session_id.');
      }
      if (isGlobalSession(session)) {
        return fail('Global sessions do not have pull requests.');
      }
      return ok(await readPrForSession(app, session));
    },
  };
}

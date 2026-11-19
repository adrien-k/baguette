import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { resolveTargetSession } from '../lib/session-resolution.js';

export function createGetSessionUsageLimitsTool(ctx) {
  const { app, userId, callerSession } = ctx;
  return {
    name: 'GetSessionUsageLimits',
    description:
      'Subscription usage limits for a session, as shown in its Usage limits card: the plan windows of its agent (e.g. Claude session/weekly/overage with percent used and reset time, Cursor included usage) ' +
      'plus what the session does at a limit (usage_limit_action: stop | wait | continue), its dollar cap for paid credits (usage_limit, null = unlimited) and the credits already spent against it (usage_limit_spent). ' +
      'Providers is empty for agents without plan limits. Omit session_id to read the current session.',
    schema: {
      session_id: z.number().int().optional().describe('Target session id (default: current)'),
    },
    handler: async ({ session_id }) => {
      const session = await resolveTargetSession(app, session_id, userId, callerSession);
      if (!session) return fail('Session not found. Provide session_id.');
      try {
        const { providers } = await app
          .service('usage')
          .subscriptionLimits(
            { agent_sdk: session.agent_sdk, agent_config_id: session.agent_config_id ?? null },
            { user: { id: userId } }
          );
        return ok({
          session_id: session.id,
          usage_limit_action: session.usage_limit_action ?? 'stop',
          usage_limit: session.usage_limit ?? null,
          usage_limit_spent: session.usage_limit_spent ?? 0,
          providers,
        });
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

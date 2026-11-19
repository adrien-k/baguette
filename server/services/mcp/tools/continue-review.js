import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

export function createContinueReviewTool(ctx) {
  const { app, userId, session: callerSession } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'ContinueReview',
    description:
      'Queue a “Review latest changes” turn on the existing session reviewer (same as the Issues tab action). ' +
      'Requires a reviewer agent from StartReview. Fails when a review turn is already running. ' +
      'Omit session_id in a repo session to target the current session.',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Target session id; defaults to the current session'),
      additional_instructions: z
        .string()
        .optional()
        .describe('Optional extra instructions appended to the review-latest prompt'),
    },
    handler: async (args) => {
      const sessionId = args.session_id ?? callerSession?.id;
      const { session, result: sessionError } = await requireMcpSession(app, sessionId, userId);
      if (sessionError) return sessionError;
      try {
        const payload = await app.service('agents').continueReview(
          {
            session_id: session.id,
            ...(args.additional_instructions != null
              ? { additional_instructions: args.additional_instructions }
              : {}),
          },
          userParams
        );
        return ok(payload);
      } catch (err) {
        return fail(err.message);
      }
    },
  };
}

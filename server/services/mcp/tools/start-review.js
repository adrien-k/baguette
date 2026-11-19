import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { requireMcpSession } from '../lib/require-mcp-session.js';

export function createStartReviewTool(ctx) {
  const { app, userId, session: callerSession } = ctx;
  const userParams = { provider: 'rest', user: { id: userId } };
  return {
    name: 'StartReview',
    description:
      'Start the session reviewer agent using your Settings → Agent reviewer default model (no model arguments). ' +
      'Fails when a review turn is already running. Fails when a reviewer agent already exists unless clear_previous_review is true (removes the prior reviewer thread first). ' +
      'Omit session_id in a repo session to target the current session.',
    schema: {
      session_id: z
        .number()
        .int()
        .optional()
        .describe('Target session id; defaults to the current session'),
      initial_prompt: z
        .string()
        .optional()
        .describe('Optional focus text for the first review turn (Issues tab focus message)'),
      extra_prompt: z
        .string()
        .optional()
        .describe('Optional extra system prompt for this review run only'),
      clear_previous_review: z
        .boolean()
        .optional()
        .describe(
          'When true, remove an existing idle reviewer agent and its thread before starting fresh'
        ),
    },
    handler: async (args) => {
      const sessionId = args.session_id ?? callerSession?.id;
      const { session, result: sessionError } = await requireMcpSession(app, sessionId, userId);
      if (sessionError) return sessionError;
      try {
        const payload = await app.service('agents').startReview(
          {
            session_id: session.id,
            ...(args.initial_prompt != null ? { initial_prompt: args.initial_prompt } : {}),
            ...(args.extra_prompt != null ? { extra_prompt: args.extra_prompt } : {}),
            ...(args.clear_previous_review === true ? { clear_previous_review: true } : {}),
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

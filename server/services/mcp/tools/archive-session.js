import { ok, fail } from '../lib/result.js';

export function createArchiveSessionTool(ctx) {
  const { app } = ctx;
  return {
    name: 'ArchiveSession',
    description:
      'Close (archive) THIS session once your current turn ends. Use only when the user explicitly ' +
      'asks to close or end the session. Reply to the user first (a short goodbye or summary): ' +
      'your final message is still delivered, and the session is archived right after it. To ' +
      'continue the work in a fresh session instead, use CreateSession.',
    schema: {},
    handler: async () => {
      const sessionId = ctx.session?.id;
      if (!sessionId) return fail('No session to archive.');
      app.service('sessions').archiveAfterTurn(sessionId);
      return ok({
        message:
          'This session will be archived as soon as your turn ends. Finish with a brief final message.',
      });
    },
  };
}

import { z } from 'zod';
import { ok, fail } from '../lib/result.js';

/** The caller's own archive waits a moment so this tool call can still be answered. */
const SELF_ARCHIVE_DELAY_MS = 1500;

/** Live sessions spawned by `sessionId`, grandchildren first, so each is archived before its parent. */
async function liveDescendants(db, sessionId, userId) {
  const ordered = [];
  const seen = new Set([sessionId]);
  const walk = async (parentId) => {
    const children = await db('sessions')
      .where({ parent_session_id: parentId, user_id: userId })
      .whereNull('archived_at')
      .select('id');
    for (const { id } of children) {
      if (seen.has(id)) continue;
      seen.add(id);
      await walk(id);
      ordered.push(id);
    }
  };
  await walk(sessionId);
  return ordered;
}

export function createArchiveSlackThreadTool(ctx) {
  const { app } = ctx;
  return {
    name: 'ArchiveSlackThread',
    description:
      'DESTRUCTIVE. Archive this Slack thread: every session you spawned (and the ones they spawned) ' +
      'and then this Slack global session itself — worktrees are removed and running agents stopped. ' +
      'Only the thread owner may ask for it. Ask the owner to confirm in the thread first, and call this ' +
      'only after they said yes in a later message. Post your goodbye with SlackPostMessage BEFORE ' +
      'calling it, call it as your last action, then end your turn with exactly NO_REPLY: this ' +
      'session is archived right after the call.',
    schema: {
      confirmed_by_owner: z
        .boolean()
        .describe('true only when the thread owner explicitly confirmed archiving in this thread'),
    },
    handler: async ({ confirmed_by_owner }) => {
      if (confirmed_by_owner !== true) {
        return fail(
          'Ask the thread owner to confirm first, then call again with confirmed_by_owner.'
        );
      }
      const session = ctx.session;
      if (!session?.id || !session.slack_app_id) {
        return fail('Only a Slack global session can archive its thread.');
      }
      const db = app.get('db');
      const asOwner = { provider: undefined, user: { id: session.user_id } };
      const archived = [];
      const failed = [];
      for (const id of await liveDescendants(db, session.id, session.user_id)) {
        try {
          await app.service('sessions').archive(id, asOwner);
          archived.push(id);
        } catch (err) {
          failed.push({ session_id: id, error: err.message });
        }
      }
      if (failed.length) {
        return fail(
          `Could not archive every spawned session, so this one stays: ${JSON.stringify(failed)}`
        );
      }
      // Archiving stops this session's own agent, so it goes last and after the reply.
      setTimeout(() => {
        app
          .service('sessions')
          .archive(session.id, asOwner)
          .catch(() => {});
      }, SELF_ARCHIVE_DELAY_MS).unref?.();
      return ok({ archived_sessions: archived, archiving_self: true });
    },
  };
}

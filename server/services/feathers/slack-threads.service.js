import { KnexService } from '@feathersjs/knex';

/**
 * Slack thread ↔ session bindings (table `slack_threads`). A thread can follow several sessions
 * over time; its newest binding is the active one, older ones remain so each session can still
 * post its final reply. Internal only: the Slack bot is its one caller, so no method is exposed.
 */
class SlackThreadsService extends KnexService {
  get threads() {
    return this.options.Model('slack_threads');
  }

  /** The session a thread is bound to now, or null (never bound, or its session is gone/archived). */
  async active(slackAppId, channelId, threadTs) {
    const thread = await this.threads
      .where({ slack_app_id: slackAppId, channel_id: channelId, thread_ts: threadTs })
      .orderBy('id', 'desc')
      .first();
    if (!thread) return null;
    const session = await this.options.Model('sessions').where({ id: thread.session_id }).first();
    return session && !session.archived_at ? thread : null;
  }

  /** Every thread a session serves. */
  async forSession(sessionId) {
    return this.threads.where({ session_id: sessionId });
  }

  /** The newest binding of a session, or null. */
  async latestForSession(sessionId) {
    return (
      (await this.threads.where({ session_id: sessionId }).orderBy('id', 'desc').first()) ?? null
    );
  }

  /** Makes a session the thread's newest binding (replacing an older binding of the same session). */
  async bind({ slackAppId, channelId, threadTs, sessionId, userId, lastPostedMessageId = 0 }) {
    // One transaction, so a failed insert keeps the old binding and concurrent binds queue up.
    await this.options.Model.transaction(async (trx) => {
      await trx('slack_threads')
        .where({
          slack_app_id: slackAppId,
          channel_id: channelId,
          thread_ts: threadTs,
          session_id: sessionId,
        })
        .delete();
      await trx('slack_threads').insert({
        slack_app_id: slackAppId,
        channel_id: channelId,
        thread_ts: threadTs,
        session_id: sessionId,
        user_id: userId,
        last_posted_message_id: lastPostedMessageId,
      });
    });
  }

  /** A session started by another session continues in the same Slack thread (if it has one). */
  async attach(fromSessionId, newSessionId) {
    if (fromSessionId == null) return;
    const from = await this.latestForSession(fromSessionId);
    if (!from) return;
    await this.bind({
      slackAppId: from.slack_app_id,
      channelId: from.channel_id,
      threadTs: from.thread_ts,
      sessionId: newSessionId,
      userId: from.user_id,
    });
  }

  /**
   * Binds an existing session to a thread without replaying its older replies or PR link. The
   * thread's other sessions are let go — a user's switch means they no longer post here — and the
   * one that was active is returned (its session id), or null.
   */
  async switchTo({ slackAppId, channelId, threadTs, session, userId }) {
    const previous = await this.active(slackAppId, channelId, threadTs);
    const lastReply = await this.options
      .Model('session_messages')
      .where({ session_id: session.id, type: 'assistant' })
      .max({ id: 'id' })
      .first();
    await this.bind({
      slackAppId,
      channelId,
      threadTs,
      sessionId: session.id,
      userId,
      lastPostedMessageId: lastReply?.id ?? 0,
    });
    await this.threads
      .where({ slack_app_id: slackAppId, channel_id: channelId, thread_ts: threadTs })
      .whereNot({ session_id: session.id })
      .delete();
    return previous && previous.session_id !== session.id ? previous.session_id : null;
  }

  /** The owner's answer about a Slack user in a session: 'approved' | 'rejected' | 'pending' | null. */
  async approvalStatus(sessionId, slackUserId) {
    const session = await this.options.Model('sessions').where({ id: sessionId }).first();
    return JSON.parse(session?.slack_approvals ?? '{}')[slackUserId] ?? null;
  }

  /** Marks a Slack user as pending for a session; false when they already have a status. */
  async requestApproval(sessionId, slackUserId, ownerSlackId) {
    const changed = await this.setApproval(sessionId, slackUserId, 'pending', null);
    if (changed) {
      await this.options
        .Model('sessions')
        .where({ id: sessionId })
        .update({ slack_owner: ownerSlackId });
    }
    return changed;
  }

  /** Stores the owner's answer; false when the user was not pending (already answered). */
  async resolveApproval(sessionId, slackUserId, approved) {
    return this.setApproval(sessionId, slackUserId, approved ? 'approved' : 'rejected', 'pending');
  }

  /** Atomically sets one user's status, only if their current one is `from` (null: none yet). */
  async setApproval(sessionId, slackUserId, status, from) {
    const path = `$."${slackUserId}"`;
    const current = `json_extract(COALESCE(slack_approvals, '{}'), ?)`;
    const guard = from ? `${current} = ?` : `${current} IS NULL`;
    const result = await this.options.Model.raw(
      `UPDATE sessions
       SET slack_approvals = json_set(COALESCE(slack_approvals, '{}'), ?, ?)
       WHERE id = ? AND ${guard}`,
      from ? [path, status, sessionId, path, from] : [path, status, sessionId, path]
    );
    return (result?.changes ?? result?.rowCount ?? 0) > 0;
  }

  /** Remembers the "Working…" message shown in a thread (null: none). */
  async setLoader(id, ts) {
    await this.threads.where({ id }).update({ status_ts: ts });
  }

  /** Remembers how far the session's replies have been posted. */
  async markPosted(id, { messageId }) {
    await this.threads.where({ id }).update({ last_posted_message_id: messageId });
  }
}

export function registerSlackThreadsService(app, path = 'slack-threads') {
  app.use(
    path,
    new SlackThreadsService({ Model: app.get('db'), name: 'slack_threads', id: 'id' }),
    { methods: [] }
  );
}

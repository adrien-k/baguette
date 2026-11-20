import { KnexService } from '@feathersjs/knex';
import { createAccountContext } from '../mcp/lib/account-context.js';
import { createCreateSessionTool } from '../mcp/tools/create-session.js';
import { createAssistantModelResolver } from '../slack-assistant-model.js';
import { parseRepoScope } from '../slack-repo-scope.js';

const ASSISTANT_LABEL = 'Slack assistant';

/**
 * Slack assistants: the global session each Baguette user talks to from Slack (rows of `sessions`
 * with `slack_app_id` set), the threads an assistant serves and the people it listens to besides
 * its owner. Internal only — the Slack bot is the one caller, so no method is exposed.
 */
class SlackAssistantsService extends KnexService {
  constructor(options, app) {
    super(options);
    this.app = app;
    /** `appId:userId` → the assistant being created, so two first messages don't create two. */
    this.starting = new Map();
  }

  get sessions() {
    return this.options.Model('sessions');
  }

  /** The live (not archived) assistant of a user in a Slack app, or null. */
  async findForUser(slackAppId, userId) {
    const session = await this.sessions
      .where({ slack_app_id: slackAppId, user_id: userId })
      .whereNull('archived_at')
      .first();
    return session ?? null;
  }

  /**
   * The user's assistant, created on first use. `prompt` is the first message when it has to be
   * created; `created` tells the caller that message is already delivered.
   * Fails with a message fit to show in Slack (e.g. no default builder model in Settings).
   */
  async ensure({ slackApp, user, prompt, messageMeta }) {
    const existing = await this.findForUser(slackApp.id, user.id);
    if (existing) return { session: existing, created: false };

    const key = `${slackApp.id}:${user.id}`;
    if (!this.starting.has(key)) {
      const start = this.start({ slackApp, user, prompt, messageMeta });
      this.starting.set(key, start);
      start.finally(() => this.starting.delete(key)).catch(() => {});
    }
    return this.starting.get(key);
  }

  /** Creates the global session through the same tool agents use, so model defaults apply. */
  async start({ slackApp, user, prompt, messageMeta }) {
    const tool = createCreateSessionTool({
      ...createAccountContext(user, this.app),
      slackAppId: slackApp.id,
      resolveBuilderModel: createAssistantModelResolver(this.app),
      initialMessageMeta: messageMeta,
      initialLabel: ASSISTANT_LABEL,
    });
    const result = await tool.handler({ is_global: true, initial_prompt: prompt });
    const created = JSON.parse(result.content[0].text);
    if (!created.ok) throw new Error(created.error);
    const session = await this.sessions.where({ id: created.sessionId }).first();
    return { session, created: true };
  }

  /** Live assistants serving a thread. */
  async forThread(slackAppId, channelId, threadTs) {
    return this.sessions
      .join('slack_session_threads as t', 't.session_id', 'sessions.id')
      .where({
        'sessions.slack_app_id': slackAppId,
        't.channel_id': channelId,
        't.thread_ts': threadTs,
      })
      .whereNull('sessions.archived_at')
      .select('sessions.*');
  }

  /** Whether an assistant serves any thread in a channel. */
  async servesChannel(sessionId, channelId) {
    const row = await this.options
      .Model('slack_session_threads')
      .where({ session_id: sessionId, channel_id: channelId })
      .first();
    return Boolean(row);
  }

  /** Makes an assistant serve a thread (no-op when it already does). */
  async joinThread(sessionId, channelId, threadTs) {
    await this.options
      .Model('slack_session_threads')
      .insert({ session_id: sessionId, channel_id: channelId, thread_ts: threadTs })
      .onConflict(['session_id', 'channel_id', 'thread_ts'])
      .ignore();
  }

  /** Slack user ids the owner allowed to talk to the assistant. */
  async allowedSlackIds(sessionId) {
    const rows = await this.options
      .Model('slack_session_allowed_users')
      .where({ session_id: sessionId })
      .orderBy('created_at', 'asc')
      .select('slack_user_id');
    return rows.map((row) => row.slack_user_id);
  }

  async isAllowed(sessionId, slackUserId) {
    const row = await this.options
      .Model('slack_session_allowed_users')
      .where({ session_id: sessionId, slack_user_id: slackUserId })
      .first();
    return Boolean(row);
  }

  /** Replaces the allow-list. */
  async setAllowedSlackIds(sessionId, slackUserIds) {
    await this.options.Model.transaction(async (trx) => {
      await trx('slack_session_allowed_users').where({ session_id: sessionId }).delete();
      const ids = [...new Set(slackUserIds)];
      if (ids.length) {
        await trx('slack_session_allowed_users').insert(
          ids.map((slack_user_id) => ({ session_id: sessionId, slack_user_id }))
        );
      }
    });
  }

  /** The Slack user id a Baguette user linked in an app, or null. */
  async slackIdOf(slackAppId, userId) {
    const link = await this.options
      .Model('slack_user_links')
      .where({ slack_app_id: slackAppId, user_id: userId })
      .first();
    return link?.slack_user_id ?? null;
  }

  /** Repository ids an app's assistants may use; null means every repository. */
  async repoScope(slackAppId) {
    const row = await this.options
      .Model('slack_apps')
      .where({ id: slackAppId })
      .first('allowed_repo_ids');
    return parseRepoScope(row?.allowed_repo_ids);
  }
}

export function registerSlackAssistantsService(app, path = 'slack-assistants') {
  app.use(
    path,
    new SlackAssistantsService({ Model: app.get('db'), name: 'sessions', id: 'id' }, app),
    {
      methods: [],
    }
  );
}

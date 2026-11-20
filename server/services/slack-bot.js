/**
 * Inbound Slack bot: hands what people say in Slack to their Slack global session and posts its
 * answers back to the thread.
 *
 * A Slack global session is a global session (one per Baguette user and Slack app) that stays free
 * to answer because it hands real work to other sessions. The bot only listens to its owner — a
 * Baguette user who linked their Slack account — and to the people the owner allowed. Everyone
 * else is ignored.
 */
import { isApprovedUser } from '../../shared/user-status.js';
import { slackMessageMeta } from '../../shared/slack-user-message.js';
import logger from '../logger.js';
import { PUBLIC_HOST } from '../config.js';
import { getPrimaryBuilderAgent } from './agents-db.js';
import {
  buildUserTurnMessageJson,
  sessionMessageIdentity,
} from './feathers/message-create-fields.js';
import { deleteMessage, setAgentSessionStatus } from './slack.js';
import {
  NO_REPLY,
  QUEUED_NOTE,
  STEERED_NOTE,
  UNTAGGED_NOTE,
  allowedPersonNote,
} from './slack-agent-notes.js';
import { createSlackContext } from './slack-context.js';
import { nudgeToLogIn, say, sayMarkdown, sayPrivately, updateOrSay } from './slack-replies.js';
import { findSecret, sensitiveReplacement } from './slack-safety.js';
import { resolveSlackText } from './slack-mentions.js';
import { createSlackStatus } from './slack-status.js';
import { extractAssistantText, mentionsWord, stripBotMention } from './slack-text.js';
import { slackUserLabel, slackUserName } from './slack-users.js';

const BOT_NAME = 'baguette';
const EVENT_DEDUP_TTL_MS = 1000 * 60 * 10;
const RECENT_ASSISTANT_ROWS = 25;
/** How long after a Slack message its thread still receives the global session's answer. */
const REPLY_TARGET_TTL_MS = 1000 * 60 * 30;

const DELIVERY_NOTES = { steer: STEERED_NOTE, queue: QUEUED_NOTE, normal: '' };

export function createSlackBot(app) {
  const db = () => app.get('db');
  const globalSessions = () => app.service('slack-global-sessions');
  const { slackContext, filesOfEvent } = createSlackContext();
  const status = createSlackStatus();
  const seenEvents = new Map();
  /** sessionId → the thread of the message the global session is answering right now. */
  const replyTargets = new Map();

  /** Slack apps with decrypted secrets (an internal service call returns plaintext). */
  async function loadApps() {
    const result = await app.service('admin/slack').find({ paginate: false });
    return Array.isArray(result) ? result : (result?.data ?? []);
  }

  /** One app by Slack's own app id — only that row's secrets are decrypted. */
  async function findAppByApiAppId(apiAppId) {
    if (typeof apiAppId !== 'string' || !apiAppId) return null;
    const row = await db()('slack_apps').where({ api_app_id: apiAppId }).first('id');
    if (!row) return null;
    return app.service('admin/slack').get(row.id, {});
  }

  /** Slack redelivers events it thinks were not acknowledged; handle each event id once. */
  function isDuplicateEvent(eventId) {
    const now = Date.now();
    for (const [id, at] of seenEvents) {
      if (now - at > EVENT_DEDUP_TTL_MS) seenEvents.delete(id);
    }
    if (!eventId) return false;
    if (seenEvents.has(eventId)) return true;
    seenEvents.set(eventId, now);
    return false;
  }

  const findLink = (slackApp, slackUserId) =>
    db()('slack_user_links')
      .where({ slack_app_id: slackApp.id, slack_user_id: slackUserId })
      .first();

  /** The approved Baguette user, or null (no id, unknown user, or not approved yet). */
  async function approvedUser(userId) {
    if (userId == null) return null;
    try {
      const user = await app.service('users').get(userId, {});
      return user && isApprovedUser(user) ? user : null;
    } catch {
      return null;
    }
  }

  // ── Who a message is for ────────────────────────────────────────────────────────────────

  /**
   * The global sessions a message goes to. The sender's own global session when they are a linked Baguette
   * user and either tagged the bot or the global session already serves the thread; plus the
   * global sessions serving the thread whose owner allowed the sender. Nobody else gets a route.
   */
  async function routesFor({ slackApp, event, threadTs, addressed }) {
    const link = await findLink(slackApp, event.user);
    const sender = await approvedUser(link?.user_id);
    const serving = await globalSessions().forThread(slackApp.id, event.channel, threadTs);
    const routes = [];

    if (sender) {
      const own = serving.find((session) => session.user_id === sender.id) ?? null;
      if (own || addressed) routes.push({ owner: sender, session: own, role: 'owner' });
    }
    for (const session of serving) {
      if (session.user_id === sender?.id) continue;
      if (!(await globalSessions().isAllowed(session.id, event.user))) continue;
      const owner = await approvedUser(session.user_id);
      if (owner) routes.push({ owner, session, role: 'allowed' });
    }
    return { routes, sender, serving };
  }

  // ── Delivering messages ─────────────────────────────────────────────────────────────────

  /** The message with mentions, channels and links written out, for the agent and the chat. */
  const readable = (slackApp, text) =>
    resolveSlackText(slackApp.bot_token, text, { botUserId: slackApp.bot_user_id });

  /** The owner as the global session should address them: "Jan (<@U1>)". */
  async function ownerLabel(slackApp, owner) {
    const slackId = await globalSessions().slackIdOf(slackApp.id, owner.id);
    return slackId ? slackUserLabel(slackApp.bot_token, slackId) : 'the owner';
  }

  /**
   * What the global session receives for a Slack message (notes, the person's words and the Slack
   * context) and how the chat labels it.
   */
  async function composeMessage({
    slackApp,
    event,
    threadTs,
    text,
    untagged,
    owner,
    role,
    followUp,
  }) {
    const token = slackApp.bot_token;
    const [readableText, context, userName] = await Promise.all([
      readable(slackApp, text),
      slackContext(slackApp, event, threadTs, text, { userId: owner.id, followUp, untagged }),
      slackUserName(token, event.user),
    ]);
    const whoNote =
      role === 'allowed'
        ? allowedPersonNote(
            await slackUserLabel(token, event.user),
            await ownerLabel(slackApp, owner)
          )
        : '';
    return {
      body: `${whoNote}${untagged ? UNTAGGED_NOTE : ''}${readableText}${context}`,
      meta: slackMessageMeta({
        userId: event.user,
        userName,
        text: readableText,
        allowed: role === 'allowed',
        untagged,
      }),
    };
  }

  /**
   * How a message reaches the global session now: `steer` into the running turn, `queue` while its
   * workspace is set up or an approval is pending (a new turn would be rejected), or `normal` —
   * the global session is idle, so the message starts a turn.
   */
  async function deliveryMode(sessionId) {
    const [session, builder] = await Promise.all([
      db()('sessions').where({ id: sessionId }).first(),
      getPrimaryBuilderAgent(db(), sessionId),
    ]);
    if (builder?.status === 'running') return 'steer';
    if (session?.status === 'provisioning' || builder?.status === 'approval') return 'queue';
    return 'normal';
  }

  async function latestAssistantMessageId(sessionId) {
    const row = await db()('session_messages')
      .where({ session_id: sessionId, type: 'assistant' })
      .max({ id: 'id' })
      .first();
    return row?.id ?? 0;
  }

  /** Answers to the message being delivered go to its thread, so remember where it came from. */
  async function armReply(sessionId, target) {
    replyTargets.set(sessionId, {
      ...target,
      afterMessageId: await latestAssistantMessageId(sessionId),
      armedAt: Date.now(),
    });
  }

  /** The thread being answered, unless it has been waiting so long that the answer is not for it. */
  function liveReplyTarget(sessionId) {
    const target = replyTargets.get(sessionId);
    if (target && Date.now() - target.armedAt > REPLY_TARGET_TTL_MS) {
      replyTargets.delete(sessionId);
      return null;
    }
    return target ?? null;
  }

  /** The thread the global session is answering, for tools that post without naming one. */
  const replyTarget = (sessionId) => {
    const target = liveReplyTarget(sessionId);
    return target ? { channel: target.channel, threadTs: target.threadTs } : null;
  };

  /** Hands a message to an existing global session. */
  async function sendToGlobalSession({
    slackApp,
    event,
    threadTs,
    text,
    untagged,
    owner,
    session,
    role,
  }) {
    const target = { channel: event.channel, threadTs };
    const followUp = (await globalSessions().forThread(slackApp.id, event.channel, threadTs)).some(
      (serving) => serving.id === session.id
    );
    const statusShown = status.show(session.id, slackApp, target).catch(() => {});
    const failed = async (message) => {
      replyTargets.delete(session.id);
      await statusShown;
      await status.clear(session.id);
      await say(slackApp, event.channel, threadTs, message);
    };

    const builder = await getPrimaryBuilderAgent(db(), session.id);
    if (!builder) {
      await failed("Your Slack global session isn't available.");
      return;
    }
    try {
      const { body, meta } = await composeMessage({
        slackApp,
        event,
        threadTs,
        text,
        untagged,
        owner,
        role,
        followUp,
      });
      await globalSessions().joinThread(session.id, event.channel, threadTs);
      // Re-read the mode last: the turn may have started or ended while the context was built.
      const mode = await deliveryMode(session.id);
      const message_json = buildUserTurnMessageJson(`${DELIVERY_NOTES[mode]}${body}`, meta);
      const identity = sessionMessageIdentity(builder);
      if (mode === 'queue') {
        await app
          .service('queued-messages')
          .create(
            { session_id: session.id, message_json, kind: 'turn', ...identity },
            { user: owner }
          );
      } else {
        await armReply(session.id, target);
        await app.service('messages').create(
          {
            session_id: session.id,
            type: 'user',
            message_json,
            ...identity,
            ...(mode === 'steer' ? { force: true } : {}),
          },
          { user: owner }
        );
      }
      await statusShown;
    } catch (err) {
      logger.warn(
        { err: err.message, sessionId: session.id },
        'slack: delivering a message failed'
      );
      await failed(`Couldn't pass that on to your Slack global session: ${err.message}`);
    }
  }

  /** A user's first message: creates their global session, with the message as its first prompt. */
  async function startGlobalSession({ slackApp, event, threadTs, text, untagged, owner }) {
    const reply = (message) => say(slackApp, event.channel, threadTs, message);
    if (!text.trim() && !(await filesOfEvent(slackApp, event, threadTs)).length) {
      await reply(
        "I'm here. Tell me what you need — I can start sessions, check on them and more."
      );
      return;
    }
    const placeholderTs = await reply('Setting up your Slack global session… 🥖');
    const target = { channel: event.channel, threadTs };
    try {
      const { body, meta } = await composeMessage({
        slackApp,
        event,
        threadTs,
        text,
        untagged,
        owner,
        role: 'owner',
        followUp: false,
      });
      const { session, created } = await globalSessions().ensure({
        slackApp,
        user: owner,
        prompt: body,
        messageMeta: meta,
      });
      await globalSessions().joinThread(session.id, event.channel, threadTs);
      if (placeholderTs) {
        await deleteMessage(slackApp.bot_token, {
          channel: event.channel,
          ts: placeholderTs,
        }).catch(() => {});
      }
      if (!created) {
        await sendToGlobalSession({
          slackApp,
          event,
          threadTs,
          text,
          untagged,
          owner,
          session,
          role: 'owner',
        });
        return;
      }
      replyTargets.set(session.id, { ...target, afterMessageId: 0, armedAt: Date.now() });
      await status.show(session.id, slackApp, target).catch(() => {});
    } catch (err) {
      logger.warn({ err: err.message }, 'slack: starting the global session failed');
      await updateOrSay(
        slackApp,
        event.channel,
        threadTs,
        placeholderTs,
        `Couldn't start your Slack global session: ${err.message}`
      );
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────────────────────

  /** A message in a channel: tagged / "baguette" (`addressed`), or untagged talk in a thread. */
  async function handleMessage({ slackApp, event, text, addressed }) {
    const threadTs = event.thread_ts ?? event.ts;
    const { routes, sender, serving } = await routesFor({ slackApp, event, threadTs, addressed });
    if (!routes.length) {
      // Strangers are ignored; someone who is not a Baguette user yet gets one private pointer,
      // unless they tagged the bot in a conversation that already belongs to someone's global session.
      if (addressed && !sender && !serving.length) await nudgeToLogIn(slackApp, event);
      return;
    }
    for (const route of routes) {
      const message = { slackApp, event, threadTs, text, untagged: !addressed, ...route };
      const existing =
        route.session ?? (await globalSessions().findForUser(slackApp.id, route.owner.id));
      if (existing) await sendToGlobalSession({ ...message, session: existing });
      else await startGlobalSession(message);
    }
  }

  /**
   * The Stop button Slack shows under a working agent (it appears once the app subscribes to
   * `agent_session_stopped`): the owner interrupts their global session. Slack leaves the status as it
   * was, so it is put back to `active` here.
   */
  async function handleAgentSessionStopped({ slackApp, event }) {
    const threadTs = event.thread_ts;
    if (!threadTs) return;
    const serving = await globalSessions().forThread(slackApp.id, event.channel, threadTs);
    if (!serving.length) return;
    const link = await findLink(slackApp, event.user);
    const owned = serving.filter((session) => session.user_id === link?.user_id);
    if (!owned.length) {
      await sayPrivately(slackApp, {
        channel: event.channel,
        user: event.user,
        threadTs,
        text: 'Only its owner can stop it.',
      });
      return;
    }
    for (const session of owned) {
      const owner = await approvedUser(session.user_id);
      if (owner) {
        await app
          .service('sessions')
          .stop(session.id, { user: owner })
          .catch((err) => logger.warn({ err: err.message }, 'slack: stop failed'));
      }
      replyTargets.delete(session.id);
      await status.clear(session.id);
    }
    await setAgentSessionStatus(slackApp.bot_token, {
      channel: event.channel,
      threadTs,
      status: 'active',
    }).catch((err) => logger.debug({ err: err.message }, 'slack: failed to reset agent status'));
  }

  /** Entry point for a verified `event_callback` payload. */
  async function handleEventCallback(slackApp, payload) {
    if (isDuplicateEvent(payload.event_id)) return;
    const event = payload.event;
    logger.debug(
      { app: slackApp.name, type: event?.type, user: event?.user, channel: event?.channel },
      'slack: event received'
    );
    if (!event?.user || event.bot_id || event.user === slackApp.bot_user_id) return;
    // Edits, joins, deletions… — but a message with files is a `file_share`.
    if (event.subtype && !['thread_broadcast', 'file_share'].includes(event.subtype)) return;

    if (event.type === 'agent_session_stopped') {
      await handleAgentSessionStopped({ slackApp, event });
      return;
    }

    const botId = slackApp.bot_user_id;
    if (event.type === 'app_mention') {
      await handleMessage({
        slackApp,
        event,
        text: stripBotMention(event.text, botId),
        addressed: true,
      });
      return;
    }
    if (event.type !== 'message' || event.channel_type === 'im') return;

    const text = String(event.text ?? '');
    // A tag also fires app_mention, which handles it — don't process it twice.
    if (botId && text.includes(`<@${botId}`)) return;
    // Saying "baguette" addresses the bot, same as a tag; other talk counts only in a thread.
    const addressed = mentionsWord(text, BOT_NAME);
    if (!addressed && !event.thread_ts) return;
    await handleMessage({ slackApp, event, text, addressed });
  }

  // ── Results ─────────────────────────────────────────────────────────────────────────────

  /**
   * What to post for a global session reply. Slack is visible to the whole company, so a reply that
   * looks like it holds a secret is replaced by a pointer to the session, where only Baguette
   * users can read it.
   */
  function replyMarkdown(text, session) {
    if (!findSecret(text)) return text;
    logger.warn({ sessionId: session.id }, 'slack: blocked a reply that looked sensitive');
    return sensitiveReplacement({
      sessionUrl: `${PUBLIC_HOST}/sessions/${session.id}`,
      prUrl: null,
    });
  }

  /** The global session's newest text since `afterMessageId`, or '' when the turn said nothing. */
  async function newestAssistantText(sessionId, afterMessageId) {
    const rows = await db()('session_messages')
      .where({ session_id: sessionId, type: 'assistant' })
      .whereIn(
        'agent_id',
        db()('agents').where({ session_id: sessionId, agent_type: 'builder' }).select('id')
      )
      .where('id', '>', afterMessageId)
      .orderBy('id', 'desc')
      .limit(RECENT_ASSISTANT_ROWS);
    for (const row of rows) {
      const text = extractAssistantText(row.message_json);
      if (text) return text;
    }
    return '';
  }

  /**
   * Posts the global session's answer to the thread of the message it answered. A turn that answers no
   * Slack message (a wake-up from a session it started) has no recent thread to post to: the global
   * session reports with SlackPostMessage.
   */
  async function postTurnResult(sessionId) {
    const target = liveReplyTarget(sessionId);
    if (!target) return;
    const session = await db()('sessions').where({ id: sessionId }).first();
    const slackApp = (await loadApps()).find((candidate) => candidate.id === session?.slack_app_id);
    if (!slackApp?.bot_token) return;

    // A turn that said nothing new may be an older one finishing just after the message arrived:
    // keep the target for the turn that answers it.
    const text = await newestAssistantText(sessionId, target.afterMessageId);
    if (!text) return;
    if (text.trim() === NO_REPLY) {
      replyTargets.delete(sessionId);
      return;
    }
    // Forget the target only once Slack has the reply, so a failed post is retried next turn.
    const posted = await sayMarkdown(
      slackApp,
      target.channel,
      target.threadTs,
      replyMarkdown(text, session)
    );
    if (posted) replyTargets.delete(sessionId);
  }

  /** Subscribes to session activity; call once after the services exist. */
  function start() {
    app.service('sessions').on('turn:complete', async (data) => {
      try {
        await status.clear(data.session_id);
        await postTurnResult(data.session_id);
      } catch (err) {
        logger.warn({ err: err.message }, 'slack: posting the global session’s answer failed');
      }
    });
  }

  return {
    findAppByApiAppId,
    handleEventCallback,
    postTurnResult,
    replyTarget,
    start,
  };
}

/**
 * Inbound Slack bot: turns tags (and talk in a thread it owns) into Baguette sessions and posts
 * the results back to the thread.
 *
 * Starting a session needs a Baguette user who linked their Slack account; anyone else gets a
 * private "log in to Baguette" nudge. Once a session runs in a thread, anyone in it can send it
 * suggestions, while the session's owner stays in charge.
 */
import logger from '../logger.js';
import { PUBLIC_HOST } from '../config.js';
import { getPrimaryBuilderAgent } from './agents-db.js';
import { createAccountContext } from './mcp/lib/account-context.js';
import { createCreateSessionTool } from './mcp/tools/create-session.js';
import {
  buildUserTurnMessageJson,
  sessionMessageIdentity,
} from './feathers/message-create-fields.js';
import { postBlocks, setAgentSessionStatus, updateMessage } from './slack.js';
import { slackMessageMeta } from '../../shared/slack-user-message.js';
import {
  NO_REPLY,
  SLACK_AGENT_INSTRUCTIONS,
  STEERED_NOTE,
  UNTAGGED_NOTE,
  suggestionNote,
} from './slack-agent-notes.js';
import { createSlackContext } from './slack-context.js';
import { createSlackLoader } from './slack-loader.js';
import { describeChoice, resolveSlackModelChoice } from './slack-model-fallback.js';
import { nudgeToLogIn, say, sayMarkdown, sayPrivately, updateOrSay } from './slack-replies.js';
import { resolveRepo } from './slack-repos.js';
import { buildApprovalBlocks, approvalPromptText, parseApprovalAction } from './slack-approvals.js';
import {
  SWITCH_ACTION_PREFIX,
  buildOldSessionBlocks,
  buildSessionPickerBlocks,
  oldSessionQuestion,
  parseOldSessionAction,
  parseSwitchRequest,
  rankSessions,
  sessionPickerLabel,
} from './slack-session-picker.js';
import {
  extractAssistantText,
  isStopRequest,
  mentionsWord,
  parseSlackOptions,
  slackBranchName,
  slackSessionTitle,
  stripBotMention,
} from './slack-text.js';
import { findSecret, sensitiveReplacement } from './slack-safety.js';
import { resolveSlackText } from './slack-mentions.js';
import { slackUserLabel, slackUserName } from './slack-users.js';

const BOT_NAME = 'baguette';
const EVENT_DEDUP_TTL_MS = 1000 * 60 * 10;
const LOADER_POLL_MS = 4000;
const PICKER_MAX_OPTIONS = 10;
const RECENT_SESSIONS_LIMIT = 60;

/** Milliseconds since the start at each named step — for the debug log. */
function stopwatch() {
  const start = Date.now();
  const laps = {};
  return {
    laps,
    lap(name) {
      laps[name] = Date.now() - start;
    },
  };
}

export function createSlackBot(app) {
  const db = () => app.get('db');
  const { slackContext, filesOfEvent } = createSlackContext();
  const seenEvents = new Map();
  const startingThreads = new Set();
  let pollTimer = null;

  /** Slack apps with decrypted secrets (an internal service call returns plaintext). */
  async function loadApps() {
    const result = await app.service('admin/slack').find({ paginate: false });
    return Array.isArray(result) ? result : (result?.data ?? []);
  }

  const threads = () => app.service('slack-threads');
  const { syncLoaders, showNow: showLoaderNow } = createSlackLoader({ db, loadApps, threads });

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
      return user?.approved ? user : null;
    } catch {
      return null;
    }
  }

  // ── Starting sessions ───────────────────────────────────────────────────────────────────

  /** The message with mentions, channels and links written out, for the agent and the chat. */
  const readable = (slackApp, text) =>
    resolveSlackText(slackApp.bot_token, text, { botUserId: slackApp.bot_user_id });

  /** Marks a message as coming from Slack, so the chat shows "Slack (name)" and what they wrote. */
  async function messageMeta(slackApp, event, text, flags = {}) {
    return slackMessageMeta({
      userId: event.user,
      userName: await slackUserName(slackApp.bot_token, event.user),
      text,
      ...flags,
    });
  }

  /** First message of a new session: the user's request plus the Slack context and instructions. */
  async function buildInitialPrompt({ slackApp, event, prompt, context }) {
    return (
      `${prompt}${context}\n\n` +
      `(Requested from Slack by ${await slackUserLabel(slackApp.bot_token, event.user)} — the ` +
      `session owner, who has the final word. ${SLACK_AGENT_INSTRUCTIONS} ` +
      `If someone asks for the session page, it is ${PUBLIC_HOST}/sessions/<this session's id>.)`
    );
  }

  /** One session per thread: a second tag while the first is still being set up must not race it. */
  async function startSession(args) {
    const { slackApp, event, threadTs } = args;
    const key = `${slackApp.id}:${event.channel}:${threadTs}`;
    if (startingThreads.has(key)) {
      await say(slackApp, event.channel, threadTs, 'Still starting the session — one moment…');
      return;
    }
    startingThreads.add(key);
    try {
      await startSessionWithFeedback(args);
    } finally {
      startingThreads.delete(key);
    }
  }

  /** Setup takes several seconds: acknowledge at once, then edit that message as it progresses. */
  async function startSessionWithFeedback({ slackApp, event, threadTs, user, text }) {
    const placeholderTs = await say(slackApp, event.channel, threadTs, 'Firing up the oven… 🥖');
    const finish = (message) =>
      updateOrSay(slackApp, event.channel, threadTs, placeholderTs, message);
    try {
      await createSessionForThread({ slackApp, event, threadTs, user, text, finish });
    } catch (err) {
      logger.error({ err }, 'slack: starting a session failed');
      await finish(`Couldn't start a session: ${err.message}`);
    }
  }

  async function createSessionForThread({ slackApp, event, threadTs, user, text, finish }) {
    const watch = stopwatch();
    const { prompt, repo: requestedRepo, branch } = parseSlackOptions(text);
    if (!prompt && !(await filesOfEvent(slackApp, event, threadTs)).length) {
      await finish(
        "I'm here. Just tell me what to work on, e.g. “Add shiny blinking rabbit to login page”"
      );
      return;
    }
    const resolved = await resolveRepo(db(), user.id, requestedRepo, prompt);
    if (resolved.error) {
      await finish(resolved.error);
      return;
    }
    const { repo } = resolved;
    watch.lap('repo');

    // The model choice and the Slack lookups for the agent's context don't depend on each other.
    const choiceTask = resolveSlackModelChoice(app, user.id, prompt);
    const contextTask = Promise.all([
      readable(slackApp, prompt),
      slackContext(slackApp, event, threadTs, text),
    ]);
    contextTask.catch(() => {}); // surfaced below; don't leave it unhandled if the choice fails
    const choice = await choiceTask;
    watch.lap('model');
    const modelShown = finish(
      `Firing up the oven (${describeChoice(choice)}) on \`${repo.full_name}\`… 🥖`
    );
    const [readablePrompt, context] = await contextTask;
    await modelShown;
    watch.lap('context');

    const tool = createCreateSessionTool({
      ...createAccountContext(user, app),
      resolveBuilderModel: async () => choice,
      initialMessageMeta: await messageMeta(slackApp, event, readablePrompt),
      // Titling the session ourselves saves the LLM call that would otherwise invent a title.
      initialLabel: slackSessionTitle(readablePrompt),
    });
    const result = await tool.handler({
      repo_id: repo.id,
      base_branch: branch ?? repo.default_branch,
      branch_name: slackBranchName(readablePrompt) ?? undefined,
      initial_prompt: await buildInitialPrompt({
        slackApp,
        event,
        prompt: readablePrompt || 'See the attached files.',
        context,
      }),
    });
    const created = JSON.parse(result.content[0].text);
    watch.lap('create');
    if (!created.ok) {
      await finish(`Couldn't start a session: ${created.error}`);
      return;
    }

    await threads().bind({
      slackAppId: slackApp.id,
      channelId: event.channel,
      threadTs,
      sessionId: created.sessionId,
      userId: user.id,
    });
    syncLoaders(created.sessionId).catch(() => {});
    logger.debug(
      { sessionId: created.sessionId, ...watch.laps },
      'slack: session start timings (ms)'
    );
    await finish(
      `On it! 🥖 Started session ${created.sessionId} on \`${repo.full_name}\` (${describeChoice(choice)}). Tag me in this thread to give it more instructions.`
    );
  }

  // ── Talking to a running session ────────────────────────────────────────────────────────

  /** Delivers a thread message to the thread's session as a new user message (as the owner). */
  async function sendFollowUp({
    slackApp,
    event,
    threadTs,
    thread,
    user,
    text,
    untagged = false,
    suggestionFrom = null,
    ownerLabel = null,
  }) {
    const watch = stopwatch();
    // First thing people see after writing: the "Working…" loader, while the rest is prepared.
    const loaderShown = showLoaderNow(thread, slackApp).catch(() => {});
    const failed = async (message) => {
      await loaderShown; // so the loader is there to be taken down, and the order is predictable
      await say(slackApp, event.channel, threadTs, message);
      syncLoaders(thread.session_id, { settled: true }).catch(() => {});
    };

    const builder = await getPrimaryBuilderAgent(db(), thread.session_id);
    if (!builder) {
      await failed("That session's agent isn't available.");
      return;
    }
    // Like the chat composer: a running agent takes the message into its turn right away; while
    // the session is still being set up (or waits for an approval) the message is queued and goes
    // in as soon as that is over. Either way the person gets an answer at once, not silence.
    const firstMode = await deliveryMode(thread.session_id);
    if (firstMode !== 'normal')
      acknowledgeBusy(slackApp, event, threadTs, firstMode).catch(() => {});
    try {
      const [readableText, context] = await Promise.all([
        readable(slackApp, text),
        slackContext(slackApp, event, threadTs, text, { followUp: true, untagged }),
      ]);
      watch.lap('context');
      // Re-check: the turn may have started or ended while the context was being read.
      const mode = await deliveryMode(thread.session_id);
      const notes = `${mode === 'steer' ? STEERED_NOTE : ''}${suggestionNote(suggestionFrom, ownerLabel)}${untagged ? UNTAGGED_NOTE : ''}`;
      const meta = await messageMeta(slackApp, event, readableText, {
        untagged,
        suggestion: Boolean(suggestionFrom),
      });
      const identity = sessionMessageIdentity(builder);
      const message_json = buildUserTurnMessageJson(`${notes}${readableText}${context}`, meta);
      if (mode === 'queue') {
        await app
          .service('queued-messages')
          .create(
            { session_id: thread.session_id, message_json, kind: 'turn', ...identity },
            { user }
          );
      } else {
        await app.service('messages').create(
          {
            session_id: thread.session_id,
            type: 'user',
            message_json,
            ...identity,
            ...(mode === 'steer' ? { force: true } : {}),
          },
          { user }
        );
      }
      watch.lap('delivered');
      await loaderShown;
      syncLoaders(thread.session_id).catch(() => {});
      logger.debug(
        { sessionId: thread.session_id, ...watch.laps },
        'slack: follow-up timings (ms)'
      );
    } catch (err) {
      await failed(`Couldn't send that to the session: ${err.message}`);
    }
  }

  /**
   * How a message reaches the session right now: `steer` into the running turn, `queue` while the
   * workspace is set up or an approval is pending (a new turn would be rejected as the agent is
   * still on the current one), or `normal` — the agent is idle, so it starts a turn.
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

  /** Instant reply to a message that arrived while the agent is busy; an update follows. */
  async function acknowledgeBusy(slackApp, event, threadTs, mode) {
    const name = await slackUserName(slackApp.bot_token, event.user);
    const greeting = name ? `Got it, ${name}!` : 'Got it!';
    const detail =
      mode === 'steer'
        ? "Slipped that into the oven while it's still baking — a quick progress update is coming right up."
        : "The oven's busy at the moment, so I've lined that up — it goes in as soon as it's ready.";
    await say(slackApp, event.channel, threadTs, `${greeting} 🥖 ${detail}`);
  }

  /** The session's owner as the agent should address them: "Jan (<@U1>)". */
  async function ownerSlackLabel(slackApp, thread) {
    const link = await db()('slack_user_links')
      .where({ slack_app_id: slackApp.id, user_id: thread.user_id })
      .first();
    return link ? slackUserLabel(slackApp.bot_token, link.slack_user_id) : 'the session owner';
  }

  /**
   * A message from someone other than the session's owner — linked to Baguette or not. It goes to
   * the session (which runs as the owner) labelled as a suggestion, so the agent weighs it but
   * the owner stays in charge.
   */
  async function sendSuggestion({ slackApp, event, threadTs, thread, text, untagged }) {
    const owner = await approvedUser(thread.user_id);
    if (!owner) return;
    const status = await threads().approvalStatus(thread.session_id, event.user);
    if (status !== 'approved') {
      // Rejected and still-pending people are ignored; the owner is asked once.
      if (!status) await askOwnerToApprove({ slackApp, event, threadTs, thread });
      return;
    }
    await sendFollowUp({
      slackApp,
      event,
      threadTs,
      thread,
      user: owner,
      text,
      untagged,
      suggestionFrom: await slackUserLabel(slackApp.bot_token, event.user),
      ownerLabel: await ownerSlackLabel(slackApp, thread),
    });
  }

  /** First message from someone else: asks the thread's owner (with buttons) to allow them. */
  async function askOwnerToApprove({ slackApp, event, threadTs, thread }) {
    const ownerLink = await db()('slack_user_links')
      .where({ slack_app_id: slackApp.id, user_id: thread.user_id })
      .first();
    if (!ownerLink) return;
    const asked = await threads().requestApproval(
      thread.session_id,
      event.user,
      ownerLink.slack_user_id
    );
    if (!asked) return; // someone else's event got there first
    const prompt = {
      sessionId: thread.session_id,
      ownerSlackId: ownerLink.slack_user_id,
      requesterSlackId: event.user,
    };
    try {
      await postBlocks(slackApp.bot_token, {
        channel: event.channel,
        threadTs,
        text: approvalPromptText(prompt),
        blocks: buildApprovalBlocks(prompt),
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'slack: failed to post approval request');
    }
  }

  /** The owner's click on Allow / Don't allow. */
  async function handleApprovalClick(slackApp, payload, { approve, sessionId, slackUserId }) {
    const channel = payload.channel?.id ?? payload.container?.channel_id;
    const ts = payload.message?.ts ?? payload.container?.message_ts;
    const threadTs = payload.message?.thread_ts ?? ts;
    const clicker = payload.user?.id;
    if (!channel || !ts || !clicker) return;

    const session = await db()('sessions').where({ id: sessionId }).first();
    if (!session || clicker !== session.slack_owner) {
      await sayPrivately(slackApp, {
        channel,
        user: clicker,
        threadTs,
        text: 'Only the session owner can answer this.',
      });
      return;
    }
    if (!(await threads().resolveApproval(sessionId, slackUserId, approve))) return;
    const who = `<@${slackUserId}>`;
    const summary = approve
      ? `✅ Allowed ${who} to give this session instructions. Ask them to resend their message.`
      : `🚫 Won't listen to ${who} in this session.`;
    await updateMessage(slackApp.bot_token, {
      channel,
      ts,
      text: summary,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }],
    }).catch((err) => logger.warn({ err: err.message }, 'slack: failed to update approval'));
  }

  // ── Stopping ────────────────────────────────────────────────────────────────────────────

  /**
   * "stop" from the session's owner: interrupt the agent, its subagents and their tools right now
   * (the same as the Stop button in Baguette) and leave the session idle until the next message.
   * The message is NOT passed on to the agent — that would only start another turn.
   */
  async function stopThreadSession({ slackApp, event, threadTs, thread, user }) {
    const reply = (text) => say(slackApp, event.channel, threadTs, text);
    if (!thread) {
      await reply("There's nothing running in this thread.");
      return;
    }
    const builder = await getPrimaryBuilderAgent(db(), thread.session_id);
    if (!['running', 'approval'].includes(builder?.status)) {
      await reply("Nothing's in the oven right now — I'm waiting for your next message.");
      return;
    }
    try {
      await app.service('sessions').stop(thread.session_id, { user });
    } catch (err) {
      logger.warn({ err: err.message, sessionId: thread.session_id }, 'slack: stop failed');
      await reply(`Couldn't stop it: ${err.message}`);
      return;
    }
    syncLoaders(thread.session_id, { settled: true }).catch(() => {});
    await reply('⏹ Pulled it out of the oven. Send me a message when you want me to continue.');
  }

  // ── Switching a thread to another session ───────────────────────────────────────────────

  async function recentSessions(userId, excludeSessionId) {
    const query = db()('sessions')
      .where({ user_id: userId })
      .whereNull('archived_at')
      .orderByRaw('COALESCE(last_activity_at, created_at) DESC')
      .limit(RECENT_SESSIONS_LIMIT);
    if (excludeSessionId != null) query.whereNot('id', excludeSessionId);
    return query;
  }

  /** Posts buttons / a select list so the user can pick which session this thread should use. */
  async function offerSessionPicker({ slackApp, event, threadTs, user, tokens, currentSessionId }) {
    const sessions = await recentSessions(user.id, currentSessionId);
    if (!sessions.length) {
      await say(
        slackApp,
        event.channel,
        threadTs,
        "You don't have another open session to switch to."
      );
      return;
    }
    const matches = tokens.length ? rankSessions(sessions, tokens) : [];
    let intro = 'Which session should this thread use?';
    if (tokens.length && !matches.length) {
      intro = "I couldn't find a session by that name — here are your latest. Which one?";
    }
    const options = (matches.length ? matches : sessions).slice(0, PICKER_MAX_OPTIONS);
    try {
      await postBlocks(slackApp.bot_token, {
        channel: event.channel,
        threadTs,
        text: intro,
        blocks: buildSessionPickerBlocks(intro, options),
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'slack: failed to post session picker');
    }
  }

  /** A click on the session picker (a Socket Mode `interactive` payload). */
  async function handleInteraction(slackApp, payload) {
    if (payload?.type !== 'block_actions') return;
    for (const candidate of payload.actions ?? []) {
      const approval = parseApprovalAction(candidate.action_id);
      if (approval) {
        await handleApprovalClick(slackApp, payload, approval);
        return;
      }
      const oldSession = parseOldSessionAction(candidate.action_id);
      if (oldSession) {
        await handleOldSessionClick(slackApp, payload, oldSession);
        return;
      }
    }
    const action = (payload.actions ?? []).find((a) =>
      a.action_id?.startsWith(SWITCH_ACTION_PREFIX)
    );
    if (!action) return;

    const sessionId = Number(action.selected_option?.value ?? action.value);
    const channel = payload.channel?.id ?? payload.container?.channel_id;
    const pickerTs = payload.message?.ts ?? payload.container?.message_ts;
    const threadTs = payload.message?.thread_ts ?? pickerTs;
    const slackUser = payload.user?.id;
    if (!sessionId || !channel || !threadTs || !slackUser) return;

    const link = await findLink(slackApp, slackUser);
    if (!link) {
      await nudgeToLogIn(slackApp, { channel, user: slackUser, thread_ts: threadTs });
      return;
    }
    const privately = (text) =>
      sayPrivately(slackApp, { channel, user: slackUser, threadTs, text });

    const current = await threads().active(slackApp.id, channel, threadTs);
    if (current && current.user_id !== link.user_id) {
      await privately('This thread belongs to a session started by someone else.');
      return;
    }
    const session = await db()('sessions')
      .where({ id: sessionId, user_id: link.user_id })
      .whereNull('archived_at')
      .first();
    if (!session) {
      await privately("I can't find that session any more (it may be archived).");
      return;
    }

    const previousId = await threads().switchTo({
      slackAppId: slackApp.id,
      channelId: channel,
      threadTs,
      session,
      userId: link.user_id,
    });
    const summary = `Switched this thread to ${sessionPickerLabel(session)}. Keep talking and it goes there.`;
    await updateMessage(slackApp.bot_token, {
      channel,
      ts: pickerTs,
      text: summary,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }],
    }).catch((err) => logger.warn({ err: err.message }, 'slack: failed to update session picker'));
    await askAboutOldSession(slackApp, { channel, threadTs, previousId });
  }

  /** Asks (with buttons) whether to archive the session a thread just switched away from. */
  async function askAboutOldSession(slackApp, { channel, threadTs, previousId }) {
    if (!previousId) return;
    const old = await db()('sessions').where({ id: previousId }).whereNull('archived_at').first();
    if (!old) return;
    try {
      await postBlocks(slackApp.bot_token, {
        channel,
        threadTs,
        text: oldSessionQuestion(old),
        blocks: buildOldSessionBlocks(old),
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'slack: failed to ask about the previous session');
    }
  }

  /** The owner's click on "Archive it" / "Keep it" for the session a thread switched away from. */
  async function handleOldSessionClick(slackApp, payload, { archive, sessionId }) {
    const channel = payload.channel?.id ?? payload.container?.channel_id;
    const ts = payload.message?.ts ?? payload.container?.message_ts;
    const threadTs = payload.message?.thread_ts ?? ts;
    const clicker = payload.user?.id;
    if (!channel || !ts || !clicker) return;

    const link = await findLink(slackApp, clicker);
    const session = await db()('sessions').where({ id: sessionId }).first();
    if (!link || !session || session.user_id !== link.user_id) {
      await sayPrivately(slackApp, {
        channel,
        user: clicker,
        threadTs,
        text: 'Only the session owner can answer this.',
      });
      return;
    }

    let summary = `Left ${sessionPickerLabel(session)} as it is. It stays in Baguette but won't post here.`;
    if (archive && session.archived_at) {
      summary = `${sessionPickerLabel(session)} was already archived.`;
    } else if (archive) {
      try {
        await app.service('sessions').archive({ id: sessionId }, { provider: undefined });
        summary = `🗄 Archived ${sessionPickerLabel(session)}.`;
      } catch (err) {
        logger.warn({ err: err.message, sessionId }, 'slack: archiving the old session failed');
        summary = `Couldn't archive ${sessionPickerLabel(session)}: ${err.message}`;
      }
    }
    await updateMessage(slackApp.bot_token, {
      channel,
      ts,
      text: summary,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }],
    }).catch((err) => logger.warn({ err: err.message }, 'slack: failed to update the question'));
  }

  // ── Events ──────────────────────────────────────────────────────────────────────────────

  /** A message addressed to the bot (a tag, or "baguette …"): start, continue or switch. */
  async function handleCommand({ slackApp, event, text }) {
    const threadTs = event.thread_ts ?? event.ts;
    const link = await findLink(slackApp, event.user);
    const thread = await threads().active(slackApp.id, event.channel, threadTs);

    // Once the owner has a session going in this thread, anyone in it can chip in.
    if (thread && link?.user_id !== thread.user_id) {
      await sendSuggestion({ slackApp, event, threadTs, thread, text, untagged: false });
      return;
    }
    const user = await approvedUser(link?.user_id);
    if (!user) {
      logger.debug({ slackUser: event.user }, 'slack: user not linked, sending login nudge');
      await nudgeToLogIn(slackApp, event);
      return;
    }

    if (isStopRequest(text)) {
      await stopThreadSession({ slackApp, event, threadTs, thread, user });
      return;
    }
    const switchRequest = parseSwitchRequest(text);
    if (switchRequest) {
      await offerSessionPicker({
        slackApp,
        event,
        threadTs,
        user,
        tokens: switchRequest.tokens,
        currentSessionId: thread?.session_id,
      });
      return;
    }
    if (!thread) {
      await startSession({ slackApp, event, threadTs, user, text });
      return;
    }
    await sendFollowUp({ slackApp, event, threadTs, thread, user, text });
  }

  /**
   * A thread message that does not address the bot. In a thread whose session is running, the
   * owner can just talk and others' messages become suggestions; anywhere else it is ignored.
   */
  async function handleUntaggedThreadMessage({ slackApp, event, text }) {
    if (!event.thread_ts) return;
    const thread = await threads().active(slackApp.id, event.channel, event.thread_ts);
    if (!thread) return;
    const base = { slackApp, event, threadTs: event.thread_ts, thread, text, untagged: true };

    const link = await findLink(slackApp, event.user);
    if (link?.user_id !== thread.user_id) {
      await sendSuggestion(base);
      return;
    }
    const user = await approvedUser(thread.user_id);
    if (!user) return;

    if (isStopRequest(text)) {
      await stopThreadSession({
        slackApp,
        event,
        threadTs: event.thread_ts,
        thread,
        user,
      });
      return;
    }
    const switchRequest = parseSwitchRequest(text);
    if (switchRequest) {
      await offerSessionPicker({
        ...base,
        user,
        tokens: switchRequest.tokens,
        currentSessionId: thread.session_id,
      });
      return;
    }
    await sendFollowUp({ ...base, user });
  }

  /**
   * The Stop button Slack shows under a working agent (it appears once the app subscribes to
   * `agent_session_stopped`). Does what "stop" does in the session: the owner interrupts the run.
   * Slack leaves the status as it was, so it is put back to `active` here.
   */
  async function handleAgentSessionStopped({ slackApp, event }) {
    const threadTs = event.thread_ts;
    if (!threadTs) return;
    const thread = await threads().active(slackApp.id, event.channel, threadTs);
    if (!thread) return;
    const link = await findLink(slackApp, event.user);
    if (link?.user_id !== thread.user_id) {
      await sayPrivately(slackApp, {
        channel: event.channel,
        user: event.user,
        threadTs,
        text: 'Only the session owner can stop it.',
      });
      return;
    }
    const user = await approvedUser(thread.user_id);
    if (user) await stopThreadSession({ slackApp, event, threadTs, thread, user });
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
      await handleCommand({ slackApp, event, text: stripBotMention(event.text, botId) });
      return;
    }
    if (event.type !== 'message' || event.channel_type === 'im') return;

    const text = String(event.text ?? '');
    // A tag also fires app_mention, which handles it — don't process it twice.
    if (botId && text.includes(`<@${botId}`)) return;
    // Saying "baguette" addresses the bot, same as a tag.
    if (mentionsWord(text, BOT_NAME)) {
      await handleCommand({ slackApp, event, text });
      return;
    }
    await handleUntaggedThreadMessage({ slackApp, event, text });
  }

  // ── Results ─────────────────────────────────────────────────────────────────────────────

  /**
   * What to post for an agent reply. Slack is visible to the whole company, so a reply that looks
   * like it holds a secret is replaced by a pointer to the session (and PR), where only Baguette
   * users can read it.
   */
  function replyMarkdown({ text, session, announcePr }) {
    const prUrl = session.pr_url ?? null;
    if (findSecret(text)) {
      logger.warn({ sessionId: session.id }, 'slack: blocked a reply that looked sensitive');
      return sensitiveReplacement({ sessionUrl: `${PUBLIC_HOST}/sessions/${session.id}`, prUrl });
    }
    if (!announcePr) return text;
    const branch = session.remote_branch || session.local_branch;
    const links = [`🔗 [Pull request #${session.pr_number}](${prUrl})`];
    if (branch) links.push(`🌿 Branch: \`${branch}\``);
    return `${text}\n\n${links.join('\n')}`;
  }

  /** Posts the session's newest assistant text (with its PR link and branch) to every thread it serves. */
  async function postTurnResult(sessionId) {
    const serving = await threads().forSession(sessionId);
    if (!serving.length) return;
    const session = await db()('sessions').where({ id: sessionId }).first();
    if (!session) return;
    const apps = await loadApps();

    for (const thread of serving) {
      const slackApp = apps.find((a) => a.id === thread.slack_app_id);
      if (!slackApp?.bot_token) continue;

      const rows = await db()('session_messages')
        .where({ session_id: sessionId, type: 'assistant' })
        .whereIn(
          'agent_id',
          db()('agents').where({ session_id: sessionId, agent_type: 'builder' }).select('id')
        )
        .where('id', '>', thread.last_posted_message_id)
        .orderBy('id', 'desc')
        .limit(25);
      const latest = rows.find((row) => extractAssistantText(row.message_json));
      if (!latest) continue;

      const text = extractAssistantText(latest.message_json);
      const isSilent = text.trim() === NO_REPLY;
      // Whenever the session has a PR, every result ends with its link and branch.
      const announcePr = !isSilent && Boolean(session.pr_url);
      // Mark it posted only once Slack has it: on a failure the pointers stay, so the next
      // turn's post retries instead of the reply (and PR link) being lost for good.
      const posted =
        isSilent ||
        (await sayMarkdown(
          slackApp,
          thread.channel_id,
          thread.thread_ts,
          replyMarkdown({ text, session, announcePr })
        ));
      if (!posted) continue;
      await threads().markPosted(thread.id, { messageId: latest.id });
    }
  }

  /** Subscribes to session activity and polls the loaders; call once after services exist. */
  function start() {
    const sessions = app.service('sessions');
    const warn = (what) => (err) => logger.warn({ err: err.message }, `slack: ${what} failed`);
    sessions.on('turn:start', (data) => {
      syncLoaders(data.session_id).catch(warn('loader sync'));
    });
    sessions.on('turn:complete', async (data) => {
      try {
        await syncLoaders(data.session_id, { settled: true });
        await postTurnResult(data.session_id);
      } catch (err) {
        warn('posting turn result')(err);
      }
    });
    // Stops from the Baguette UI don't always emit a turn event, so also check on a timer.
    pollTimer = setInterval(() => syncLoaders().catch(warn('loader poll')), LOADER_POLL_MS);
    pollTimer.unref?.();
  }

  function stop() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    findAppByApiAppId,
    handleEventCallback,
    handleInteraction,
    postTurnResult,
    slackContext,
    syncLoaders,
    attachSessionToThread: (fromSessionId, newSessionId) =>
      threads().attach(fromSessionId, newSessionId),
    start,
    stop,
  };
}

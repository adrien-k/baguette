/**
 * The context block attached to every message the agent receives from Slack, so it can start
 * working without calling tools: who wrote it, where, the thread (or what was said since its last
 * reply), attached files, linked Slack messages, and the channel just before the thread.
 */
import {
  getChannelHistory,
  getChannelInfo,
  getMessageFiles,
  getThreadReplies,
  normalizeSlackFile,
} from './slack.js';
import { attachmentsContext, slackFilesDir } from './slack-files.js';
import { parseSlackThreadUrl } from './mcp/tools/slack-read-thread.js';
import { resolveSlackText } from './slack-mentions.js';
import { slackUserLabel } from './slack-users.js';
import { SENSITIVE_REMINDER } from './slack-agent-notes.js';
import { slackLinksIn, stripBotMention } from './slack-text.js';

const MESSAGE_MAX_CHARS = 800;
const THREAD_MAX_MESSAGES = 30;
const CHANNEL_MESSAGES_BEFORE = 2;

const clip = (value) =>
  value.length > MESSAGE_MAX_CHARS ? `${value.slice(0, MESSAGE_MAX_CHARS)}…` : value;

/** "2026-10-28 01:35" (UTC) from a Slack ts; '' if it is not one. */
export function slackClock(ts) {
  const seconds = Number(String(ts).split('.')[0]);
  if (!Number.isFinite(seconds)) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function createSlackContext() {
  const channelInfos = new Map();

  /** "[01:35] Jan Havlena (<@U1>): text [files: a.json]" — who said it, when, and what. */
  async function formatMessage(slackApp, message) {
    const who = await slackUserLabel(slackApp.bot_token, message.user);
    const readable = await resolveSlackText(
      slackApp.bot_token,
      stripBotMention(message.text, slackApp.bot_user_id),
      {
        botUserId: slackApp.bot_user_id,
      }
    );
    const text = clip(readable);
    const files = message.files?.length
      ? ` [files: ${message.files.map((file) => file.name).join(', ')}]`
      : '';
    return `[${slackClock(message.ts)}] ${who}: ${text}${files}`;
  }

  const formatAll = (slackApp, messages) =>
    Promise.all(messages.map((message) => formatMessage(slackApp, message)));

  /** Human messages of the thread other than the tagging one; best effort ('' on any failure). */
  async function threadContext(slackApp, event, threadTs, { sinceLastBotReply }) {
    if (!event.thread_ts) return '';
    try {
      let replies = await getThreadReplies(slackApp.bot_token, {
        channel: event.channel,
        ts: threadTs,
      });
      if (sinceLastBotReply) {
        const lastBot = replies.findLastIndex((m) => m.user === slackApp.bot_user_id);
        replies = replies.slice(lastBot + 1);
      }
      const others = replies.filter(
        (m) =>
          m.ts !== event.ts && m.user !== slackApp.bot_user_id && (m.text.trim() || m.files?.length)
      );
      if (!others.length) return '';
      const shown = others.slice(-THREAD_MAX_MESSAGES);
      const omitted = others.length - shown.length;
      const heading = sinceLastBotReply
        ? 'Other messages in the thread since your last reply'
        : 'The thread so far';
      const note = omitted ? ` (${omitted} earlier messages omitted — use SlackReadThread)` : '';
      return `\n\n${heading}${note}:\n${(await formatAll(slackApp, shown)).join('\n')}`;
    } catch {
      return '';
    }
  }

  /**
   * The last couple of channel messages before the thread started. They may or may not be
   * related — people often tag the bot right after talking about the problem — so the agent
   * is told to judge.
   */
  async function channelContext(slackApp, event, threadTs) {
    try {
      const page = await getChannelHistory(slackApp.bot_token, {
        channel: event.channel,
        limit: CHANNEL_MESSAGES_BEFORE + 4,
        latest: threadTs,
      });
      const before = page.messages
        .filter((m) => m.ts !== threadTs && !m.is_bot && (m.text.trim() || m.files?.length))
        .slice(-CHANNEL_MESSAGES_BEFORE);
      if (!before.length) return '';
      const plural = before.length === 1 ? '' : 's';
      return (
        `\n\nThe last ${before.length} message${plural} in the channel before this thread ` +
        `(they may or may not be related to it):\n${(await formatAll(slackApp, before)).join('\n')}`
      );
    } catch {
      return '';
    }
  }

  /** "#dev (C123) — topic: …; purpose: …", or just the id when the channel cannot be read. */
  async function describeChannel(slackApp, channelId) {
    const key = `${slackApp.id}:${channelId}`;
    if (!channelInfos.has(key)) {
      try {
        channelInfos.set(key, await getChannelInfo(slackApp.bot_token, channelId));
      } catch {
        channelInfos.set(key, null);
      }
    }
    const info = channelInfos.get(key);
    if (!info?.name) return channelId;
    const details = [
      info.isPrivate && 'private channel',
      info.topic && `topic: ${clip(info.topic)}`,
      info.purpose && `purpose: ${clip(info.purpose)}`,
    ].filter(Boolean);
    return `#${info.name} (${channelId})${details.length ? ` — ${details.join('; ')}` : ''}`;
  }

  /** Slack threads the user linked in the message, so "look at this" works. */
  async function linkedContext(slackApp, text) {
    const blocks = [];
    for (const url of slackLinksIn(text)) {
      const ref = parseSlackThreadUrl(url);
      if (!ref) continue;
      try {
        const replies = await getThreadReplies(slackApp.bot_token, {
          channel: ref.channel,
          ts: ref.threadTs,
        });
        const lines = await formatAll(
          slackApp,
          replies.filter((m) => m.text.trim() || m.files?.length)
        );
        blocks.push(`Linked Slack thread (${url}):\n${lines.join('\n')}`);
      } catch (err) {
        blocks.push(
          `Linked Slack thread (${url}) could not be read (${err.slackError ?? err.message}); ` +
            'ask the user to invite the bot to that channel or to tag you in the thread.'
        );
      }
    }
    return blocks.length ? `\n\n${blocks.join('\n\n')}` : '';
  }

  /** Files on the tagging message. `app_mention` events may not carry them, so look them up. */
  async function filesOfEvent(slackApp, event, threadTs) {
    if (event.files) return event.files.map(normalizeSlackFile);
    if (event.type !== 'app_mention') return [];
    try {
      return await getMessageFiles(slackApp.bot_token, {
        channel: event.channel,
        ts: event.ts,
        threadTs: event.thread_ts ?? threadTs,
      });
    } catch {
      return [];
    }
  }

  async function attachedFiles(slackApp, event, threadTs) {
    const files = await filesOfEvent(slackApp, event, threadTs);
    const dir = slackFilesDir(slackApp.id, event.channel, threadTs);
    return attachmentsContext(slackApp.bot_token, files, dir);
  }

  /**
   * @param {{ followUp?: boolean, untagged?: boolean }} [options] `followUp`: only add what was
   *   said since the agent's last reply; `untagged`: the message was not addressed to the bot.
   */
  async function slackContext(
    slackApp,
    event,
    threadTs,
    text,
    { followUp = false, untagged = false } = {}
  ) {
    const [channel, sender, ...sections] = await Promise.all([
      describeChannel(slackApp, event.channel),
      slackUserLabel(slackApp.bot_token, event.user),
      attachedFiles(slackApp, event, threadTs),
      threadContext(slackApp, event, threadTs, { sinceLastBotReply: followUp }),
      channelContext(slackApp, event, threadTs),
      linkedContext(slackApp, text),
    ]);
    const header =
      `Message from ${sender}${untagged ? ' (not tagged to you)' : ''}\n` +
      `Channel: ${channel}\n` +
      `Thread: ${threadTs} (sent ${slackClock(event.ts)} UTC)`;
    return (
      '\n\n---\nSlack context (provided automatically; use the Slack tools only for more):\n' +
      `${SENSITIVE_REMINDER}\n` +
      header +
      sections.join('')
    );
  }

  return { slackContext, filesOfEvent };
}

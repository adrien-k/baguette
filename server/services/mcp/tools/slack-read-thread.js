import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';
import { getThreadReplies } from '../../slack.js';
import { slackUserName } from '../../slack-users.js';

/**
 * Channel + thread timestamp from a Slack permalink, e.g.
 * https://acme.slack.com/archives/C0123ABCD/p1793148695336489?thread_ts=1793148000.000100&cid=C0123ABCD
 * A `thread_ts` query parameter (the message is a reply) wins over the `p…` message id.
 */
export function parseSlackThreadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/i);
  if (!match) return null;
  const [, channel, seconds, micros] = match;
  const threadTs = parsed.searchParams.get('thread_ts') ?? `${seconds}.${micros}`;
  return { channel, threadTs };
}

export function createSlackReadThreadTool(ctx) {
  const slack = createSlackHelpers(ctx);
  const { app } = ctx;
  return {
    name: 'SlackReadThread',
    description:
      'Read a whole Slack thread (every message, oldest first). With no arguments it reads the ' +
      'thread this session was started from. Pass `url` (a Slack message link the user gave you) ' +
      'to read another thread. Use it when the user refers to something said in Slack — "the bug ' +
      'above", "what we discussed". Messages carry the author (user id plus `user_name`) and any attached `files` (fetch one with SlackDownloadFile). If you cannot tell ' +
      'which thread the user means, do NOT guess: ask them, like a person would ("Hmm, I\'m a bit ' +
      'lost — which thread do you mean? Send me a link to it, or tag me there.").',
    schema: {
      url: z
        .string()
        .optional()
        .describe('Slack message/thread link (…/archives/C…/p…). Omit for the current thread.'),
      channel: z.string().optional().describe('Channel id, together with thread_ts'),
      thread_ts: z.string().optional().describe('Thread timestamp, together with channel'),
      app: z.string().optional().describe(`Slack app to read as. ${slack.slackAppHint}`),
    },
    handler: slackHandler(async ({ url, channel, thread_ts: threadTsArg, app: appName }) => {
      let channelId = channel;
      let threadTs = threadTsArg;
      if (url) {
        const parsed = parseSlackThreadUrl(url);
        if (!parsed) {
          return fail(
            "That doesn't look like a Slack message link. Ask the user for the link (in Slack: ⋯ → Copy link)."
          );
        }
        ({ channel: channelId, threadTs } = parsed);
      }

      const sessionId = ctx.session?.id;
      const own = sessionId
        ? await app
            .get('db')('slack_threads')
            .where({ session_id: sessionId })
            .orderBy('id', 'desc')
            .first()
        : null;
      if (!channelId || !threadTs) {
        if (!own) {
          return fail(
            'This session is not tied to a Slack thread. Ask the user to send you a link to the thread (⋯ → Copy link) or to tag you in it.'
          );
        }
        channelId = own.channel_id;
        threadTs = own.thread_ts;
      }

      let slackApp;
      if (own && !appName) {
        const apps = await slack.loadSlackApps();
        slackApp = apps.find((a) => a.id === own.slack_app_id);
      }
      slackApp ??= await slack.resolveSlackApp(appName);

      await slack.assertMayReadChannel(slackApp, channelId);

      let messages;
      try {
        messages = await getThreadReplies(slackApp.bot_token, {
          channel: channelId,
          ts: threadTs,
          limit: 200,
        });
      } catch (err) {
        if (['channel_not_found', 'not_in_channel', 'thread_not_found'].includes(err.slackError)) {
          return fail(
            `I can't read that thread (${err.slackError}). The bot may not be in that channel — ask the user to invite it (/invite @bot) or to tag you in the thread.`
          );
        }
        throw err;
      }
      return ok({
        channel: channelId,
        thread_ts: threadTs,
        messages: await Promise.all(
          messages.map(async (m) => ({
            ts: m.ts,
            user: m.user,
            user_name: await slackUserName(slackApp.bot_token, m.user),
            is_bot: m.is_bot,
            text: m.text,
            files: m.files,
          }))
        ),
      });
    }),
  };
}

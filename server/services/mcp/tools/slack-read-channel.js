import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';
import { getChannelHistory } from '../../slack.js';
import { slackUserName } from '../../slack-users.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createSlackReadChannelTool(ctx) {
  const slack = createSlackHelpers(ctx);
  return {
    name: 'SlackReadChannel',
    description:
      'Read recent messages of a Slack channel (top-level messages only), one page at a time. ' +
      `Returns the latest ${DEFAULT_LIMIT} by default, oldest first within the page; messages that ` +
      'started a thread show `reply_count` — read those with SlackReadThread. To go further back, ' +
      'call again with the returned `next_cursor` (it pages back in time) or pass `latest` (a ts) ' +
      `to read messages before a point. Raise \`limit\` (max ${MAX_LIMIT}) only when you really ` +
      'need more. In a session started from Slack, `channel` defaults to the thread’s channel. ' +
      'Use it when the user points at "the channel", "what was said earlier", or a past discussion. ' +
      'If you still cannot tell what they mean, ask them (a link to the message helps).',
    schema: {
      channel: z
        .string()
        .optional()
        .describe('Channel id (C…) or name (#eng). Omit for this session’s Slack channel.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(`How many messages (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
      cursor: z.string().optional().describe('`next_cursor` from a previous call: older messages'),
      latest: z.string().optional().describe('Only messages before this ts'),
      oldest: z.string().optional().describe('Only messages after this ts'),
      app: z.string().optional().describe(`Slack app to read as. ${slack.slackAppHint}`),
    },
    handler: slackHandler(
      async ({ channel, limit = DEFAULT_LIMIT, cursor, latest, oldest, app: appName }) => {
        const bound = channel ? null : await slack.getBoundThread();
        if (!channel && !bound) {
          return fail(
            'channel is required: this session was not started from a Slack thread. Pass a channel id or name.'
          );
        }

        let slackApp;
        if (bound && !appName) {
          const apps = await slack.loadSlackApps();
          slackApp = apps.find((a) => a.id === bound.slack_app_id);
        }
        slackApp ??= await slack.resolveSlackApp(appName);

        const channelId = bound
          ? bound.channel_id
          : await slack.slackResolveChannelId(slackApp.bot_token, channel);
        await slack.assertMayReadChannel(slackApp, channelId);
        try {
          const page = await getChannelHistory(slackApp.bot_token, {
            channel: channelId,
            limit: Math.min(limit, MAX_LIMIT),
            cursor,
            latest,
            oldest,
          });
          return ok({
            channel: channelId,
            messages: await Promise.all(
              page.messages.map(async (m) => ({
                ...m,
                user_name: await slackUserName(slackApp.bot_token, m.user),
              }))
            ),
            has_more: page.hasMore,
            next_cursor: page.nextCursor,
          });
        } catch (err) {
          if (['channel_not_found', 'not_in_channel', 'missing_scope'].includes(err.slackError)) {
            return fail(
              `I can't read that channel (${err.slackError}). The bot may not be in it — ask the user to invite it (/invite @bot), or ask them to paste a link to what they mean.`
            );
          }
          throw err;
        }
      }
    ),
  };
}

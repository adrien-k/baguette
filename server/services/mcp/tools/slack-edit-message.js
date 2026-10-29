import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';
import { findSecret, sensitiveToolError } from '../../slack-safety.js';
import { updateMessage } from '../../slack.js';

export function createSlackEditMessageTool(ctx) {
  const slack = createSlackHelpers(ctx);
  return {
    name: 'SlackEditMessage',
    description:
      'Edit a Slack message you posted earlier with SlackPostMessage — e.g. keep ONE status ' +
      'message up to date ("Working… 3 of 5 steps done") instead of posting many, or fix a ' +
      'mistake. Pass the `ts` that SlackPostMessage returned. Only messages posted by the bot ' +
      'can be edited. In a session started from a Slack thread, `channel` can be omitted. Never ' +
      'put secrets or anything sensitive in it: Slack is public to the whole company. Text ' +
      'uses Slack mrkdwn: *bold*, _italic_, `code`, <https://url|label>.',
    schema: {
      ts: z.string().describe('Timestamp of the message to edit (from SlackPostMessage)'),
      text: z.string().describe('The new message text (Slack mrkdwn); replaces the old text'),
      channel: z
        .string()
        .optional()
        .describe('Channel id the message is in. Omit for this session’s Slack thread.'),
      app: z.string().optional().describe(`Slack app that posted it. ${slack.slackAppHint}`),
    },
    handler: slackHandler(async ({ ts, text, channel, app: appName }) => {
      const secret = findSecret(text);
      if (secret) {
        return fail(
          sensitiveToolError({
            kind: secret,
            sessionUrl: slack.sessionUrl(await slack.getSession()),
          })
        );
      }
      const bound = channel ? null : await slack.getBoundThread();
      if (!channel && !bound) {
        return fail(
          'channel is required: this session was not started from a Slack thread. Pass the channel id the message is in.'
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
      await updateMessage(slackApp.bot_token, { channel: channelId, ts, text });
      return ok({ channel: channelId, ts, app: slackApp.name });
    }),
  };
}

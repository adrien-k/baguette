import { z } from 'zod';
import { ok } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';

export function createSlackPostMessageTool(ctx) {
  const slack = createSlackHelpers(ctx);
  return {
    name: 'SlackPostMessage',
    description:
      'Post a message to a Slack channel — for example to report a finished task or a failing ' +
      'build to the team. Returns the message `ts` and a permalink. Text uses Slack mrkdwn: ' +
      '*bold*, _italic_, `code`, ```block```, <https://url|label>.',
    schema: {
      text: z.string().describe('Message text (Slack mrkdwn)'),
      channel: z
        .string()
        .describe('Channel id (e.g. C0123ABCD) or name (e.g. #eng). Invite the bot to it first.'),
      app: z.string().optional().describe(`Slack app to post as. ${slack.slackAppHint}`),
    },
    handler: slackHandler(async ({ text, channel, app: appName }) => {
      const slackApp = await slack.resolveSlackApp(appName);
      const channelId = await slack.slackResolveChannelId(slackApp.bot_token, channel);
      const s = await slack.getSession();
      const { ts } = await slack.slackPostMessage(slackApp.bot_token, {
        channel: channelId,
        text: slack.withSlackFooter(text, s),
      });
      const permalink = await slack
        .slackGetPermalink(slackApp.bot_token, {
          channel: channelId,
          ts,
        })
        .catch(() => null);
      return ok({ channel: channelId, ts, permalink, app: slackApp.name });
    }),
  };
}

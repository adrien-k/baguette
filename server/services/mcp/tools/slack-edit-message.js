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
      'can be edited. While you answer a Slack message, `channel` can be omitted. Never ' +
      'put secrets or anything sensitive in it: Slack is public to the whole company. Text ' +
      'uses Slack mrkdwn: *bold*, _italic_, `code`, <https://url|label>.',
    schema: {
      ts: z.string().describe('Timestamp of the message to edit (from SlackPostMessage)'),
      text: z.string().describe('The new message text (Slack mrkdwn); replaces the old text'),
      channel: z
        .string()
        .optional()
        .describe(
          'Channel id the message is in. Omit to use the channel of the message you are answering.'
        ),
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
      const { slackApp, channelId } = await slack.resolveTarget({ channel, appName });
      await updateMessage(slackApp.bot_token, { channel: channelId, ts, text });
      return ok({ channel: channelId, ts, app: slackApp.name });
    }),
  };
}

import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';
import { findSecret, sensitiveToolError } from '../../slack-safety.js';

export function createSlackPostMessageTool(ctx) {
  const slack = createSlackHelpers(ctx);
  return {
    name: 'SlackPostMessage',
    description:
      'Post a message to Slack. In a session that was started from a Slack thread, call it with ' +
      'just `text` to post into that thread — use it to keep the user updated while you work ' +
      '(what you are starting, milestones, anything blocking you) and, when the task is done, a ' +
      'short summary with the pull request link. Your final reply of each turn is already posted ' +
      'to the thread automatically, so use this for updates in between; keep the returned `ts` ' +
      'if you want to change the message later with SlackEditMessage. To post elsewhere pass ' +
      '`channel`. Returns the message `ts` and a permalink. NEVER post secrets or anything sensitive (keys, tokens, passwords, .env or config contents, personal data): Slack is public to the whole company — point to the session chat instead. Text uses Slack mrkdwn: *bold*, ' +
      '_italic_, `code`, ```block```, <https://url|label>.',
    schema: {
      text: z.string().describe('Message text (Slack mrkdwn)'),
      channel: z
        .string()
        .optional()
        .describe(
          'Channel id (e.g. C0123ABCD) or name (e.g. #eng); invite the bot to it first. Omit to post in this session’s Slack thread.'
        ),
      thread_ts: z.string().optional().describe('Reply in the thread with this timestamp'),
      app: z.string().optional().describe(`Slack app to post as. ${slack.slackAppHint}`),
    },
    handler: slackHandler(async ({ text, channel, thread_ts: threadTsArg, app: appName }) => {
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
      const threadTs = threadTsArg ?? bound?.thread_ts;
      const s = await slack.getSession();
      const { ts } = await slack.slackPostMessage(slackApp.bot_token, {
        channel: channelId,
        threadTs,
        // Updates inside the session's own thread need no origin footer; elsewhere they do.
        text: bound ? text : slack.withSlackFooter(text, s),
      });
      const permalink = await slack
        .slackGetPermalink(slackApp.bot_token, { channel: channelId, ts })
        .catch(() => null);
      return ok({ channel: channelId, ts, permalink, app: slackApp.name });
    }),
  };
}

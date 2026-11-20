import { z } from 'zod';
import { ok, fail } from '../lib/result.js';
import { slackHandler, createSlackHelpers } from '../lib/slack.js';
import { findSecret, sensitiveToolError } from '../../slack-safety.js';

export function createSlackPostMessageTool(ctx) {
  const slack = createSlackHelpers(ctx);
  return {
    name: 'SlackPostMessage',
    description:
      'Post a message to Slack. While you answer a Slack message, call it with just `text` to post ' +
      'into that message’s thread. When nobody is waiting on an answer (a session you started ' +
      'finished, say) pass `channel` and `thread_ts` of the thread to report in. Use it to keep ' +
      'people updated (what you started, progress, results with the pull request link). Your ' +
      'final reply to a Slack message is posted to its thread automatically; keep the returned ' +
      '`ts` to change a message later with SlackEditMessage. Returns the message `ts` and a permalink. NEVER post secrets or anything sensitive (keys, tokens, passwords, .env or config contents, personal data): Slack is public to the whole company — point to the session chat instead. Text uses Slack mrkdwn: *bold*, ' +
      '_italic_, `code`, ```block```, <https://url|label>.',
    schema: {
      text: z.string().describe('Message text (Slack mrkdwn)'),
      channel: z
        .string()
        .optional()
        .describe(
          'Channel id (e.g. C0123ABCD) or name (e.g. #eng); invite the bot to it first. Omit to answer the Slack message you are handling.'
        ),
      thread_ts: z
        .string()
        .optional()
        .describe('Reply in the thread with this timestamp (with `channel`)'),
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
      const {
        slackApp,
        channelId,
        threadTs: replyThreadTs,
      } = await slack.resolveTarget({
        channel,
        appName,
      });
      const threadTs = threadTsArg ?? replyThreadTs;
      const s = await slack.getSession();
      const { ts } = await slack.slackPostMessage(slackApp.bot_token, {
        channel: channelId,
        threadTs,
        // A conversation inside a thread needs no origin footer; a post elsewhere does.
        text: threadTs && s.slack_app_id ? text : await slack.withSlackFooter(text, s),
      });
      const permalink = await slack
        .slackGetPermalink(slackApp.bot_token, { channel: channelId, ts })
        .catch(() => null);
      return ok({ channel: channelId, ts, permalink, app: slackApp.name });
    }),
  };
}

/** Posting replies as the bot. Failures are logged, never thrown — a reply must not break a turn. */
import logger from '../logger.js';
import { PUBLIC_API_URL } from '../config.js';
import { signSlackToken } from './slack-auth.js';
import { postEphemeral, postMarkdown, postMessage, updateMessage } from './slack.js';
import { toSlackMrkdwn } from './slack-text.js';

/** Posts plain text; returns the message `ts`, or null if it could not be posted. */
export async function say(slackApp, channel, threadTs, text) {
  try {
    const { ts } = await postMessage(slackApp.bot_token, { channel, threadTs, text });
    return ts;
  } catch (err) {
    logger.warn({ err: err.message, channel }, 'slack: failed to post reply');
    return null;
  }
}

/** Edits an earlier bot message in place; posts a fresh reply if it can't be edited. */
export async function updateOrSay(slackApp, channel, threadTs, ts, text) {
  if (ts) {
    try {
      await updateMessage(slackApp.bot_token, { channel, ts, text });
      return;
    } catch (err) {
      logger.warn({ err: err.message, channel }, 'slack: failed to update reply');
    }
  }
  await say(slackApp, channel, threadTs, text);
}

/** Agent text is markdown; Slack renders it natively, with a mrkdwn fallback. True if posted. */
export async function sayMarkdown(slackApp, channel, threadTs, markdown) {
  try {
    await postMarkdown(slackApp.bot_token, {
      channel,
      threadTs,
      markdown,
      fallbackText: toSlackMrkdwn(markdown),
    });
    return true;
  } catch (err) {
    logger.warn({ err: err.message, channel }, 'slack: failed to post markdown reply');
    return false;
  }
}

/** A message only `user` sees. Failures are ignored. */
export async function sayPrivately(slackApp, { channel, user, threadTs, text }) {
  try {
    await postEphemeral(slackApp.bot_token, { channel, user, threadTs, text });
  } catch (err) {
    logger.warn({ err: err.message, channel }, 'slack: failed to send private reply');
  }
}

/**
 * Unlinked users get one private nudge and nothing else. Top-level tags get it in the channel,
 * since private thread replies are easy to miss.
 */
export async function nudgeToLogIn(slackApp, { channel, user, thread_ts: threadTs }) {
  const token = signSlackToken({ slack_app_id: slackApp.id, slack_user_id: user });
  const url = `${PUBLIC_API_URL}/api/slack/link?token=${encodeURIComponent(token)}`;
  await sayPrivately(slackApp, {
    channel,
    user,
    threadTs,
    text:
      "Hi, I'm not allowed to talk to strangers 🧐 " +
      `Please <${url}|log in to Baguette> if you want anything from me, then tag me again.`,
  });
}

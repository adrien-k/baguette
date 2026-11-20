/**
 * Slack writes mentions, channels and links into message text as `<@U123>`, `<#C123|dev>`,
 * `<https://x|label>`. Turn them into something the agent can read: who a mentioned person is, what
 * a channel is called, where a link goes.
 */
import { slackUserLabel } from './slack-users.js';

const USER_MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
const CHANNEL_MENTION = /<#[CG][A-Z0-9]+\|([^>]+)>/g;
const SPECIAL_MENTION = /<!(here|channel|everyone)(?:\|[^>]*)?>/g;
const GROUP_MENTION = /<!subteam\^[A-Z0-9]+\|([^>]+)>/g;
const DATE_FALLBACK = /<!date\^[^|>]*\|([^>]+)>/g;
const LINK = /<((?:https?|mailto):[^>|]+)(?:\|([^>]+))?>/g;

/**
 * @param {string} token bot token (for looking people up)
 * @param {string} text Slack message text
 * @param {{ botUserId?: string }} [options] the bot's own mention reads as "you"
 */
export async function resolveSlackText(token, text, { botUserId } = {}) {
  let result = String(text ?? '');

  const ids = [...new Set([...result.matchAll(USER_MENTION)].map((match) => match[1]))];
  const labels = new Map(
    await Promise.all(
      ids.map(async (id) => [id, id === botUserId ? 'you' : await slackUserLabel(token, id)])
    )
  );
  result = result.replace(USER_MENTION, (_match, id) => labels.get(id));

  return result
    .replace(CHANNEL_MENTION, '#$1')
    .replace(GROUP_MENTION, '$1')
    .replace(SPECIAL_MENTION, '@$1')
    .replace(DATE_FALLBACK, '$1')
    .replace(LINK, (_match, url, label) => (label ? `${label} (${url})` : url));
}

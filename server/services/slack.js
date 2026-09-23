/**
 * Thin Slack Web API client.
 *
 * Pure network helpers only — no DB access. Callers pass a bot token.
 */

const SLACK_API = 'https://slack.com/api';

/** Slack errors that are worth explaining rather than echoing raw. */
const ERROR_HINTS = {
  invalid_auth:
    'The Slack bot token is invalid or was revoked. Update it in Settings → Integrations.',
  not_authed: 'No Slack bot token configured. Set one in Settings → Integrations.',
  account_inactive: 'The Slack bot token belongs to a deactivated account.',
  token_revoked:
    'The Slack bot token has been revoked. Issue a new one in Settings → Integrations.',
  channel_not_found:
    'Channel not found. Use a channel ID (e.g. C0123ABCD), or invite the bot to the channel first.',
  not_in_channel:
    'The bot is not a member of that channel. Invite it with /invite @<bot> in Slack.',
  is_archived: 'That channel is archived.',
  missing_scope: 'The Slack app is missing an OAuth scope required for this call.',
  ratelimited: 'Slack rate-limited the request. Retry in a few seconds.',
};

export class SlackApiError extends Error {
  constructor(method, slackError) {
    const hint = ERROR_HINTS[slackError];
    super(
      hint
        ? `Slack ${method} failed: ${slackError} — ${hint}`
        : `Slack ${method} failed: ${slackError}`
    );
    this.name = 'SlackApiError';
    this.slackError = slackError;
    this.slackMethod = method;
  }
}

async function request(token, method, url, init) {
  if (!token) throw new SlackApiError(method, 'not_authed');
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'baguette-app',
      ...(init?.headers ?? {}),
    },
  });
  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`Slack ${method} returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!payload.ok) throw new SlackApiError(method, payload.error || `http_${res.status}`);
  return payload;
}

function post(token, method, body) {
  return request(token, method, `${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body ?? {}),
  });
}

function get(token, method, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return request(token, method, `${SLACK_API}/${method}${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

// Channel-name → id lookups, memoised per token for the life of the process so a tool that is
// given `#eng` instead of an id does not pay for conversations.list on every call.
const channelIdCache = new Map();

function looksLikeChannelId(value) {
  return /^[CDG][A-Z0-9]{6,}$/i.test(value);
}

/**
 * `chat.postMessage` tolerates `#channel-name`, but resolving it here turns Slack's opaque
 * `channel_not_found` into an error that names the channel and says how to find the right one.
 */
export async function resolveChannelId(token, channel) {
  if (typeof channel !== 'string' || !channel.trim()) {
    throw new Error(
      'A Slack channel is required. Pass a channel id (e.g. C0123ABCD) or name (e.g. #eng).'
    );
  }
  const raw = channel.trim();
  if (looksLikeChannelId(raw)) return raw;

  const name = raw.replace(/^#/, '').toLowerCase();
  const cacheKey = `${token}:${name}`;
  if (channelIdCache.has(cacheKey)) return channelIdCache.get(cacheKey);

  const channels = await listChannels(token, { types: 'public_channel,private_channel' });
  const match = channels.find((c) => c.name.toLowerCase() === name);
  if (!match) {
    throw new Error(
      `Slack channel "#${name}" not found, or the bot has not been invited to it. Channels it can reach: ${
        channels.map((c) => `#${c.name}`).join(', ') || '(none)'
      }`
    );
  }
  channelIdCache.set(cacheKey, match.id);
  return match.id;
}

/** Verifies the token and returns the workspace/bot identity. */
export async function authTest(token) {
  const res = await post(token, 'auth.test');
  return { team: res.team, teamId: res.team_id, user: res.user, userId: res.user_id, url: res.url };
}

export async function postMessage(token, { channel, text, unfurlLinks = true }) {
  const res = await post(token, 'chat.postMessage', {
    channel,
    text,
    unfurl_links: unfurlLinks,
    unfurl_media: unfurlLinks,
  });
  return { channel: res.channel, ts: res.ts };
}

/** Permalink for a message — cheap to fetch and the most useful handle to give back to an agent. */
export async function getPermalink(token, { channel, ts }) {
  const res = await get(token, 'chat.getPermalink', { channel, message_ts: ts });
  return res.permalink;
}

export async function listChannels(token, { types = 'public_channel', limit = 200 } = {}) {
  const res = await get(token, 'conversations.list', { types, limit, exclude_archived: true });
  return (res.channels ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    is_private: !!c.is_private,
    is_member: !!c.is_member,
  }));
}

/**
 * Thin Slack Web API client.
 *
 * Pure network helpers only — no DB access. Callers pass a bot token.
 */

import { PUBLIC_API_URL } from '../config.js';

const SLACK_API = 'https://slack.com/api';

export const slackEventsUrl = () => `${PUBLIC_API_URL}/api/slack/events`;
export const slackRedirectUri = () => `${PUBLIC_API_URL}/api/slack/oauth/callback`;

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

export const SLACK_REQUEST_TIMEOUT_MS = 15_000;

async function request(token, method, url, init) {
  if (!token) throw new SlackApiError(method, 'not_authed');
  let res;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'baguette-app',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(`Slack ${method} timed out after ${SLACK_REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
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

export async function postMessage(token, { channel, text, threadTs, unfurlLinks = true }) {
  const res = await post(token, 'chat.postMessage', {
    channel,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    unfurl_links: unfurlLinks,
    unfurl_media: unfurlLinks,
  });
  return { channel: res.channel, ts: res.ts };
}

/** Slack's `markdown` block holds at most 12,000 characters. */
const SLACK_MARKDOWN_BLOCK_LIMIT = 12000;

/**
 * Posts standard (GitHub-style) markdown — headings, lists, code, tables, links — using Slack's
 * `markdown` block. `fallbackText` is the notification text and what clients without block
 * support show; if Slack rejects the block the message is sent as plain mrkdwn instead.
 */
export async function postMarkdown(token, { channel, markdown, fallbackText, threadTs }) {
  try {
    const res = await post(token, 'chat.postMessage', {
      channel,
      text: fallbackText,
      blocks: [{ type: 'markdown', text: markdown.slice(0, SLACK_MARKDOWN_BLOCK_LIMIT) }],
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    return { channel: res.channel, ts: res.ts };
  } catch (err) {
    if (!['invalid_blocks', 'invalid_blocks_format'].includes(err.slackError)) throw err;
    return postMessage(token, { channel, text: fallbackText, threadTs });
  }
}

/** Edits a message the bot posted earlier (used to turn "Starting…" into "Started"). */
export async function updateMessage(token, { channel, ts, text, blocks }) {
  await post(token, 'chat.update', { channel, ts, text, ...(blocks ? { blocks } : {}) });
}

/**
 * One page of channel history (top-level messages; threads show as `reply_count`). Slack pages
 * newest-first with an opaque cursor; the page is returned oldest-first for reading.
 */
export async function getChannelHistory(token, { channel, limit = 20, cursor, oldest, latest }) {
  const res = await get(token, 'conversations.history', {
    channel,
    limit,
    cursor,
    oldest,
    latest,
  });
  const messages = (res.messages ?? [])
    .map((m) => ({
      ts: m.ts,
      user: m.user,
      text: m.text ?? '',
      is_bot: Boolean(m.bot_id),
      thread_ts: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined,
      reply_count: m.reply_count || undefined,
      files: filesOf(m),
    }))
    .reverse();
  return {
    messages,
    hasMore: Boolean(res.has_more),
    nextCursor: res.response_metadata?.next_cursor || null,
  };
}

/** Name and visibility of a channel (needs `channels:read` / `groups:read`). */
export async function getChannelInfo(token, channel) {
  const res = await get(token, 'conversations.info', { channel });
  return {
    name: res.channel?.name ?? null,
    isPrivate: Boolean(res.channel?.is_private),
    // Direct and group messages are private even where Slack does not flag them `is_private`.
    isDirect: Boolean(res.channel?.is_im || res.channel?.is_mpim),
    topic: res.channel?.topic?.value || null,
    purpose: res.channel?.purpose?.value || null,
  };
}

const MEMBERS_PAGE = 1000;
const MEMBERS_MAX_PAGES = 20;

/**
 * Whether a Slack user is in a conversation (needs `channels:read` / `groups:read`, and the bot
 * in it). Gives up — false — rather than scan a huge member list to the end.
 */
export async function isChannelMember(token, channel, user) {
  let cursor;
  for (let page = 0; page < MEMBERS_MAX_PAGES; page += 1) {
    const res = await get(token, 'conversations.members', {
      channel,
      limit: MEMBERS_PAGE,
      cursor,
    });
    if ((res.members ?? []).includes(user)) return true;
    cursor = res.response_metadata?.next_cursor;
    if (!cursor) return false;
  }
  return false;
}

/** Who a Slack user id is (needs the `users:read` scope). */
export async function getUserInfo(token, user) {
  const res = await get(token, 'users.info', { user });
  const profile = res.user?.profile ?? {};
  return {
    id: user,
    name: profile.display_name || res.user?.real_name || res.user?.name || null,
    username: res.user?.name || null,
    realName: res.user?.real_name || null,
    title: profile.title || null,
    isBot: Boolean(res.user?.is_bot),
  };
}

/** Every member of the workspace, for matching a typed username to its Slack id (needs `users:read`). */
export async function listUsers(token) {
  const users = [];
  let cursor;
  do {
    const res = await get(token, 'users.list', { limit: 200, cursor });
    for (const user of res.members ?? []) {
      if (user.deleted || user.is_bot) continue;
      users.push({
        id: user.id,
        username: user.name || null,
        name: user.profile?.display_name || user.real_name || user.name || null,
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return users;
}

/** Metadata (and download link) of one file by id (needs `files:read`). */
export async function getFileInfo(token, fileId) {
  const res = await get(token, 'files.info', { file: fileId });
  return normalizeSlackFile(res.file ?? {});
}

/** Files attached to one message — for events (like `app_mention`) that do not carry them. */
export async function getMessageFiles(token, { channel, ts, threadTs }) {
  const res =
    threadTs && threadTs !== ts
      ? await get(token, 'conversations.replies', {
          channel,
          ts: threadTs,
          oldest: ts,
          inclusive: true,
          limit: 1,
        })
      : await get(token, 'conversations.history', {
          channel,
          latest: ts,
          inclusive: true,
          limit: 1,
        });
  const message = (res.messages ?? []).find((m) => m.ts === ts);
  return message ? filesOf(message) : [];
}

/** Deletes a message the bot posted (used to remove the "Working…" loader). */
export async function deleteMessage(token, { channel, ts }) {
  await post(token, 'chat.delete', { channel, ts });
}

/**
 * The animated "<app> is …" line under a thread (needs `assistant:write`). Slack clears it when the
 * app posts in the thread; an empty `status` clears it at once.
 */
export async function setThreadStatus(token, { channel, threadTs, status }) {
  await post(token, 'assistant.threads.setStatus', {
    channel_id: channel,
    thread_ts: threadTs,
    status,
  });
}

/**
 * The native agent status of a thread (`processing` shows Slack's animated loading state, `active`
 * means ready again). With the `agent_session_stopped` event subscribed it also shows a Stop
 * button; Slack never changes the status itself, so the app must set it back when work ends.
 */
export async function setAgentSessionStatus(token, { channel, threadTs, status }) {
  await post(token, 'agents.sessions.setStatus', {
    channel_id: channel,
    thread_ts: threadTs,
    status,
  });
}

/** Message with Block Kit `blocks` (buttons, select menus); `text` is the notification fallback. */
export async function postBlocks(token, { channel, text, blocks, threadTs }) {
  const res = await post(token, 'chat.postMessage', {
    channel,
    text,
    blocks,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  return { channel: res.channel, ts: res.ts };
}

/** Message only `user` can see — used to nudge people who have not linked their Baguette account. */
export async function postEphemeral(token, { channel, user, text, threadTs }) {
  await post(token, 'chat.postEphemeral', {
    channel,
    user,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}

/** A Slack file reduced to what we use; `url` is the authenticated download link. */
export function normalizeSlackFile(file) {
  return {
    id: file.id,
    name: file.name || file.title || 'file',
    mimetype: file.mimetype ?? null,
    filetype: file.filetype ?? null,
    size: file.size ?? null,
    // Deleted files and files hidden by a workspace limit have no download link.
    url: file.url_private_download || file.url_private || null,
    // Where the file was shared and who uploaded it — to decide who may read it.
    channel_ids: [
      ...new Set([
        ...(file.channels ?? []),
        ...(file.groups ?? []),
        ...(file.ims ?? []),
        ...Object.keys(file.shares?.public ?? {}),
        ...Object.keys(file.shares?.private ?? {}),
      ]),
    ],
    user_id: file.user ?? null,
  };
}

const filesOf = (message) => (message.files ?? []).map(normalizeSlackFile);

/** Earlier messages of a thread (oldest first), for context when the bot is tagged mid-thread. */
export async function getThreadReplies(token, { channel, ts, limit = 100 }) {
  const res = await get(token, 'conversations.replies', { channel, ts, limit });
  return (res.messages ?? []).map((m) => ({
    ts: m.ts,
    user: m.user,
    text: m.text ?? '',
    is_bot: Boolean(m.bot_id),
    files: filesOf(m),
  }));
}

const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'users:read',
  'files:read',
  'chat:write',
  'assistant:write',
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
];

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_BOT_SCOPES.join(','),
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

/** Exchanges the OAuth `code` from the install redirect for a bot token and workspace identity. */
export async function oauthAccess({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'baguette-app' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!payload?.ok)
    throw new SlackApiError('oauth.v2.access', payload?.error || `http_${res.status}`);
  return {
    botToken: payload.access_token,
    botUserId: payload.bot_user_id,
    apiAppId: payload.app_id,
    teamId: payload.team?.id,
    teamName: payload.team?.name,
  };
}

/** Permalink for a message — cheap to fetch and the most useful handle to give back to an agent. */
export async function getPermalink(token, { channel, ts }) {
  const res = await get(token, 'chat.getPermalink', { channel, message_ts: ts });
  return res.permalink;
}

/** Channels the bot user belongs to — the set we can actually post to after name resolution. */
export async function listChannels(token, { types = 'public_channel', limit = 200 } = {}) {
  const channels = [];
  let cursor;
  for (;;) {
    const res = await get(token, 'users.conversations', {
      types,
      limit,
      exclude_archived: true,
      ...(cursor ? { cursor } : {}),
    });
    for (const c of res.channels ?? []) {
      channels.push({
        id: c.id,
        name: c.name,
        is_private: !!c.is_private,
        is_member: !!c.is_member,
      });
    }
    cursor = res.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return channels;
}

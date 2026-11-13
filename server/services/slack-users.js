/**
 * Slack user id → who that is, cached. Needs the `users:read` scope; without it names are simply
 * unavailable and callers fall back to the bare id — nothing breaks.
 */
import logger from '../logger.js';
import { getUserInfo, listUsers } from './slack.js';

const CACHE_TTL_MS = 1000 * 60 * 30;
const cache = new Map(); // `${token}:${userId}` -> { at, profile }
const BLOCKED_TTL_MS = 1000 * 60; // re-check soon: the app may have been reinstalled with the scope
const blockedTokens = new Map(); // token -> when users:read was found missing

/** { name, realName, username } for a user, or null when it cannot be looked up. */
export async function slackUserProfile(token, userId) {
  if (!userId) return null;
  const blockedAt = blockedTokens.get(token);
  if (blockedAt && Date.now() - blockedAt < BLOCKED_TTL_MS) return null;
  const key = `${token}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.profile;
  try {
    const info = await getUserInfo(token, userId);
    const profile = {
      name: info.name,
      realName: info.realName ?? null,
      username: info.username ?? null,
    };
    cache.set(key, { at: Date.now(), profile });
    return profile;
  } catch (err) {
    logger.warn(
      { err: err.message, slackError: err.slackError, userId },
      'Slack user lookup failed'
    );
    if (err.slackError === 'missing_scope') {
      blockedTokens.set(token, Date.now());
      return null; // not cached, so a reinstall with the scope takes effect right away
    }
    cache.set(key, { at: Date.now(), profile: null });
    return null;
  }
}

/** The name people see for the user (their display name), or null. */
export async function slackUserName(token, userId) {
  return (await slackUserProfile(token, userId))?.name ?? null;
}

/**
 * "Jan Havlena (@honza · <@U123>)" — the real name, the handle, and the mention the agent can use
 * to address them. Falls back to "<@U123>" when the user cannot be looked up.
 */
export async function slackUserLabel(token, userId) {
  if (!userId) return 'unknown';
  const profile = await slackUserProfile(token, userId);
  const name = profile?.realName || profile?.name;
  if (!name) return `<@${userId}>`;
  const handle = profile.username && profile.username !== name ? `@${profile.username} · ` : '';
  return `${name} (${handle}<@${userId}>)`;
}

/** The handle people read for a user: "@honza", else their display name, else the bare id. */
export async function slackUserHandle(token, userId) {
  const profile = await slackUserProfile(token, userId);
  const handle = profile?.username || profile?.name;
  return handle ? `@${handle}` : userId;
}

/**
 * Maps typed usernames (with or without "@", matched against handle or display name) to Slack
 * user ids. Returns { ids, unknown } — `unknown` lists what matched nobody.
 */
export async function resolveSlackUsernames(token, usernames) {
  const members = await listUsers(token);
  const ids = [];
  const unknown = [];
  for (const raw of usernames) {
    const wanted = raw.trim().replace(/^@/, '').toLowerCase();
    if (!wanted) continue;
    const match = members.find(
      (m) => m.username?.toLowerCase() === wanted || m.name?.toLowerCase() === wanted
    );
    if (match) ids.push(match.id);
    else unknown.push(raw.trim());
  }
  return { ids, unknown };
}

/** Test hook: forget everything cached. */
export function resetSlackUserCache() {
  cache.clear();
  blockedTokens.clear();
}

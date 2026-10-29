import {
  getChannelInfo,
  getPermalink as slackGetPermalink,
  isChannelMember,
  postMessage as slackPostMessage,
  resolveChannelId as slackResolveChannelId,
} from '../../slack.js';
import { PUBLIC_HOST } from '../../../config.js';
import { fail } from './result.js';

/** Slack apps with a usable bot token, via the admin CRUD service (internal = decrypted). */
export async function loadConfiguredSlackApps(app) {
  const service = app.service?.('admin/slack');
  if (!service?.find) return [];
  try {
    const result = await service.find({ paginate: false });
    const rows = Array.isArray(result) ? result : (result?.data ?? []);
    return rows.filter((row) => row.bot_token);
  } catch {
    return [];
  }
}

function formatSlackAppList(apps) {
  return apps.map((a) => `"${a.name}"`).join(', ');
}

/** Slack failures are expected (bad channel, missing scope) — report them, don't crash the turn. */
export function slackHandler(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      return fail(err.message);
    }
  };
}

export function createSlackHelpers(ctx) {
  const { app, getSession, describeAgent, slackApps: initialSlackApps } = ctx;

  const sessionUrl = (s) => `${PUBLIC_HOST}/sessions/${s.id}`;

  const slackAppNames = initialSlackApps.map((a) => a.name);
  const slackAppHint =
    slackAppNames.length > 1
      ? `One of: ${formatSlackAppList(initialSlackApps)}.`
      : slackAppNames.length === 1
        ? `Defaults to "${slackAppNames[0]}".`
        : 'Configured in Settings → Integrations.';

  /** Picks a Slack app by name, or the only configured one. Reloads in case apps changed mid-session. */
  const resolveSlackApp = async (appName) => {
    const apps = await loadConfiguredSlackApps(app);
    if (!apps.length) {
      throw new Error('Slack is not configured. Add a Slack app in Settings → Integrations.');
    }
    if (appName) {
      const found = apps.find((a) => a.name === appName);
      if (!found) {
        throw new Error(`Unknown Slack app "${appName}". Available: ${formatSlackAppList(apps)}.`);
      }
      return found;
    }
    if (apps.length === 1) return apps[0];
    throw new Error(
      `Multiple Slack apps configured (${formatSlackAppList(apps)}). Pass \`app\` to choose one.`
    );
  };

  /** Slack messages carry their origin so a human can jump from the thread to the session. */
  const withSlackFooter = (text, s) =>
    `${text}\n\n_via <${sessionUrl(s)}|baguette> · ${describeAgent(s)} · session ${s.id}_`;

  /** The Slack user id the session's owner has linked for this app, or null. */
  const ownerSlackId = async (slackApp, sessionId) => {
    const db = app.get('db');
    const session = await db('sessions').where({ id: sessionId }).first();
    if (!session) return null;
    const link = await db('slack_user_links')
      .where({ slack_app_id: slackApp.id, user_id: session.user_id })
      .first();
    return link?.slack_user_id ?? null;
  };

  /**
   * Whether this session may read a Slack channel. The bot token sees every channel the bot is
   * in, so reads are limited to what the session's owner could read themselves: the channel
   * the session's own thread lives in, public channels, and private channels / DMs the owner
   * (by their linked Slack account) is a member of. Anything unverifiable is refused.
   */
  const mayReadChannel = async (slackApp, channelId) => {
    try {
      const session = await getSession();
      if (!session?.id) return false;
      const own = await app.service('slack-threads').forSession(session.id);
      if (own.some((t) => t.slack_app_id === slackApp.id && t.channel_id === channelId)) {
        return true;
      }
      const info = await getChannelInfo(slackApp.bot_token, channelId);
      if (!info.isPrivate && !info.isDirect) return true;
      const slackUser = await ownerSlackId(slackApp, session.id);
      if (!slackUser) return false;
      return await isChannelMember(slackApp.bot_token, channelId, slackUser);
    } catch {
      return false;
    }
  };

  const channelRefusal = (channelId) =>
    `I can't read ${channelId}: it is private and the session owner is not verifiably a member ` +
    "(or it is not this session's own thread). Ask them to paste what they mean here instead.";

  const assertMayReadChannel = async (slackApp, channelId) => {
    if (!(await mayReadChannel(slackApp, channelId))) throw new Error(channelRefusal(channelId));
  };

  /** A file is readable where its channel is, or by the person who uploaded it. */
  const assertMayReadFile = async (slackApp, file) => {
    for (const channelId of file.channel_ids ?? []) {
      if (await mayReadChannel(slackApp, channelId)) return;
    }
    const session = await getSession();
    const slackUser = session?.id ? await ownerSlackId(slackApp, session.id) : null;
    if (slackUser && file.user_id === slackUser) return;
    throw new Error(
      "I can't download that file: it was not shared somewhere the session owner can read."
    );
  };

  return {
    assertMayReadChannel,
    assertMayReadFile,
    sessionUrl,
    slackAppHint,
    resolveSlackApp,
    loadSlackApps: () => loadConfiguredSlackApps(app),
    /** The Slack thread this session was started from (newest binding), if any. */
    getBoundThread: async () => {
      const s = await getSession();
      return s?.id ? app.service('slack-threads').latestForSession(s.id) : null;
    },
    withSlackFooter,
    slackPostMessage,
    slackGetPermalink,
    slackResolveChannelId,
    getSession,
  };
}

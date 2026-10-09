import {
  getPermalink as slackGetPermalink,
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
    `${text}\n\n_via <${sessionUrl(s)}|baguette> · ${describeAgent(s)} · session ${s.short_id || s.id}_`;

  return {
    slackAppHint,
    resolveSlackApp,
    withSlackFooter,
    slackPostMessage,
    slackGetPermalink,
    slackResolveChannelId,
    getSession,
  };
}

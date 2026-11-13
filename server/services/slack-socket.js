/**
 * Slack Socket Mode: Baguette dials out to Slack with the app-level token and receives events
 * over a WebSocket, so no public URL, tunnel or signing secret is needed.
 *
 * One connection per Slack app row that has both a bot token and an app token. Rows are re-read
 * periodically, so saving or removing an app in Settings takes effect without a restart.
 */
import logger from '../logger.js';
import { authTest } from './slack.js';

const DEFAULT_APP_NAME = 'baguette';
const SYNC_INTERVAL_MS = 30_000;
const OPEN_CONNECTION_TIMEOUT_MS = 15_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

async function openConnectionUrl(appToken, fetchFn) {
  const res = await fetchFn('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${appToken}`, 'User-Agent': 'baguette-app' },
    signal: AbortSignal.timeout(OPEN_CONNECTION_TIMEOUT_MS),
  });
  const payload = await res.json().catch(() => null);
  if (!payload?.ok)
    throw new Error(`apps.connections.open failed: ${payload?.error ?? res.status}`);
  return payload.url;
}

export function createSlackSocketManager(
  app,
  bot,
  { fetchFn = fetch, WebSocketImpl = globalThis.WebSocket } = {}
) {
  const slackService = () => app.service('admin/slack');
  const connections = new Map(); // slack_apps.id -> { fingerprint, stop }
  let timer = null;

  /** Fills in who the bot is (needed to strip its mention and ignore its own messages). */
  async function refreshIdentity(slackApp) {
    const identity = await authTest(slackApp.bot_token);
    const patch = {
      bot_user_id: identity.userId,
      team_id: identity.teamId,
      team_name: identity.team,
    };
    await slackService().saveIdentity(slackApp.id, patch);
    return { ...slackApp, ...patch };
  }

  async function handleMessage(slackApp, ws, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return slackApp;
    }
    if (message.type === 'hello') {
      const apiAppId = message.connection_info?.app_id;
      if (apiAppId && apiAppId !== slackApp.api_app_id) {
        await slackService().saveIdentity(slackApp.id, { api_app_id: apiAppId });
        return { ...slackApp, api_app_id: apiAppId };
      }
      return slackApp;
    }
    if (message.type === 'disconnect') {
      ws.close();
      return slackApp;
    }
    if (message.envelope_id) {
      // Ack immediately; Slack redelivers anything not acknowledged within seconds.
      ws.send(JSON.stringify({ envelope_id: message.envelope_id }));
    }
    if (message.type === 'interactive' && message.payload) {
      bot
        .handleInteraction(slackApp, message.payload)
        .catch((err) => logger.error({ err }, 'slack: socket interaction failed'));
    }
    if (message.type === 'events_api' && message.payload) {
      bot
        .handleEventCallback(slackApp, message.payload)
        .catch((err) => logger.error({ err }, 'slack: socket event handling failed'));
    }
    return slackApp;
  }

  function connect(initial) {
    let slackApp = initial;
    let stopped = false;
    let ws = null;
    let delay = RECONNECT_MIN_MS;
    let retryTimer = null;

    const scheduleReconnect = () => {
      if (stopped) return;
      retryTimer = setTimeout(run, delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    };

    async function run() {
      try {
        slackApp = await refreshIdentity(slackApp);
        if (stopped) return;
        const url = await openConnectionUrl(slackApp.app_token, fetchFn);
        // stop() may have run during the awaits above, when there was no socket to close yet.
        if (stopped) return;
        ws = new WebSocketImpl(url);
        ws.addEventListener('open', () => {
          delay = RECONNECT_MIN_MS;
          logger.info(
            { app: slackApp.name, team: slackApp.team_name },
            'Slack Socket Mode connected'
          );
        });
        ws.addEventListener('message', (event) => {
          handleMessage(slackApp, ws, event.data)
            .then((next) => {
              slackApp = next;
            })
            .catch((err) => logger.error({ err }, 'slack: socket message failed'));
        });
        ws.addEventListener('close', scheduleReconnect);
        ws.addEventListener('error', (event) =>
          logger.warn({ app: slackApp.name, err: event.message }, 'Slack Socket Mode error')
        );
      } catch (err) {
        logger.warn({ app: slackApp.name, err: err.message }, 'Slack Socket Mode connect failed');
        scheduleReconnect();
      }
    }

    run();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }

  async function sync() {
    const result = await slackService().find({ paginate: false });
    // One connection per Slack app: two rows sharing an app token would split events between them.
    const seenAppTokens = new Set();
    const rows = (Array.isArray(result) ? result : (result?.data ?? []))
      .filter((row) => row.bot_token && row.app_token)
      .sort((a, b) => a.id - b.id)
      .filter((row) => {
        if (seenAppTokens.has(row.app_token)) return false;
        seenAppTokens.add(row.app_token);
        return true;
      });
    const wanted = new Set(rows.map((r) => r.id));
    for (const [id, conn] of connections) {
      if (!wanted.has(id)) {
        conn.stop();
        connections.delete(id);
      }
    }
    for (const row of rows) {
      const fingerprint = `${row.bot_token}:${row.app_token}`;
      const existing = connections.get(row.id);
      if (existing?.fingerprint === fingerprint) continue;
      existing?.stop();
      connections.set(row.id, { fingerprint, stop: connect(row) });
    }
  }

  /**
   * Creates an app named "baguette" from SLACK_BOT_TOKEN / SLACK_APP_TOKEN so a fresh dev setup
   * works without filling in the settings form. Never touches an existing app: if one already
   * uses this app token, or the name is taken, nothing is overwritten.
   */
  async function seedFromEnv() {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!botToken || !appToken) return;
    const result = await slackService().find({ paginate: false });
    const all = Array.isArray(result) ? result : (result?.data ?? []);
    if (all.some((row) => row.app_token === appToken)) return;

    const names = new Set(all.map((row) => row.name));
    let name = DEFAULT_APP_NAME;
    for (let n = 2; names.has(name); n += 1) name = `${DEFAULT_APP_NAME}-${n}`;
    await slackService().create({ name, bot_token: botToken, app_token: appToken });
  }

  async function start() {
    try {
      await seedFromEnv();
      await sync();
    } catch (err) {
      logger.warn({ err: err.message }, 'slack: socket mode startup failed');
    }
    timer = setInterval(() => {
      sync().catch((err) => logger.warn({ err: err.message }, 'slack: socket sync failed'));
    }, SYNC_INTERVAL_MS);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    for (const conn of connections.values()) conn.stop();
    connections.clear();
  }

  return { start, stop, sync, handleMessage };
}

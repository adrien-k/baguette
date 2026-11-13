/**
 * The "Working…" indicator in a Slack thread, so people always see that something is happening.
 *
 * Preferably Slack's native status under the thread: an animated "Baguette is cooking…" line
 * (`assistant.threads.setStatus`, needs `assistant:write`) and the agent state `processing`
 * (`agents.sessions.setStatus`), which adds a Stop button once the app subscribes to
 * `agent_session_stopped`. Either one is enough. When Slack refuses both, a "🥖 Baguette is
 * cooking…" message is posted and edited instead.
 *
 * It appears at once when a message is passed to the session, says what the session is doing —
 * setting up its workspace, or running a tool — with the time it has taken, and is removed when
 * the agent stops being busy: the turn finished, or it was stopped in the Baguette UI (which does
 * not always emit a turn event, hence the poll in the bot).
 */
import logger from '../logger.js';
import { getPrimaryBuilderAgent } from './agents-db.js';
import { deleteMessage, setAgentSessionStatus, setThreadStatus, updateMessage } from './slack.js';
import { say } from './slack-replies.js';

const LOOKBACK_DAYS = 7;
/** How long a freshly shown loader waits for the agent's turn to actually start. */
const START_GRACE_MS = 90_000;
/** How often a visible loader may be edited (Slack rate-limits message updates). */
const REFRESH_MS = 20_000;
/** Show the elapsed time once it is worth mentioning. */
const SHOW_ELAPSED_AFTER_MS = 30_000;

/** Slack's native status is only re-sent this often unless its text changed (it lapses after ~2 min). */
const NATIVE_REFRESH_MS = 60_000;
/** How long a token whose native status was refused is left alone before trying it again. */
const NATIVE_BLOCKED_MS = 5 * 60_000;

/** SQLite `CURRENT_TIMESTAMP` format, so string comparison against `created_at` is correct. */
const sqliteTimestamp = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/** "2m 10s" */
export function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** "mcp__baguette__SearchSessions" → "SearchSessions" */
export const toolDisplayName = (name) =>
  String(name ?? '')
    .split('__')
    .pop();

/** The loader's text: what is going on, what the agent is running, how long it has taken. */
export function loaderText({ state, activity, elapsedMs }) {
  const base =
    state === 'provisioning'
      ? '🥖 Heating up the oven (setting up the workspace)…'
      : '🥖 Baguette is cooking…';
  const parts = [base];
  if (activity) parts.push(`running ${activity}`);
  if (elapsedMs >= SHOW_ELAPSED_AFTER_MS) parts.push(formatElapsed(elapsedMs));
  return parts.join(' · ');
}

/** The native status line; Slack puts the app's name in front: "Baguette is cooking…". */
export function nativeStatusText({ state, activity, elapsedMs }) {
  const base =
    state === 'provisioning'
      ? 'is heating up the oven (setting up the workspace)…'
      : 'is cooking… 🥖';
  const parts = [base];
  if (activity) parts.push(`running ${activity}`);
  if (elapsedMs >= SHOW_ELAPSED_AFTER_MS) parts.push(formatElapsed(elapsedMs));
  return parts.join(' · ');
}

export function createSlackLoader({ db, loadApps, threads, now = Date.now }) {
  const busyRows = new Set();
  /** rowId → { since, sawWorking }: loaders shown before the agent's turn has begun. */
  const pending = new Map();
  /** rowId → { text, at, since }: what a visible loader currently says. */
  const shown = new Map();
  /** rowId → { text, at, since }: threads currently showing Slack's native status. */
  const nativeShown = new Map();
  /** bot token → when Slack last refused the native status. */
  const nativeBlocked = new Map();

  /** What the session is doing: 'provisioning', 'working', or null (idle, archived, gone). */
  async function sessionState(sessionId) {
    const session = await db()('sessions').where({ id: sessionId }).first();
    if (!session || session.archived_at) return null;
    if (session.status === 'provisioning') return 'provisioning';
    const builder = await getPrimaryBuilderAgent(db(), sessionId);
    return builder?.status === 'running' ? 'working' : null;
  }

  /** The tool the agent is running right now, if any. */
  async function currentActivity(sessionId) {
    const row = await db()('session_messages')
      .where({ session_id: sessionId, type: 'tool_call' })
      .orderBy('id', 'desc')
      .first();
    if (!row) return null;
    try {
      const call = JSON.parse(row.message_json);
      return call.status === 'running' ? toolDisplayName(call.name) : null;
    } catch {
      return null;
    }
  }

  /**
   * Sets the animated status line and the `processing` agent state (each may be refused on its
   * own); false when Slack refuses both, so the message loader takes over.
   */
  async function setNative(row, slackApp, text) {
    const token = slackApp.bot_token;
    const blockedAt = nativeBlocked.get(token);
    if (blockedAt && now() - blockedAt < NATIVE_BLOCKED_MS) return false;
    const target = { channel: row.channel_id, threadTs: row.thread_ts };
    const results = await Promise.allSettled([
      setThreadStatus(token, { ...target, status: text }),
      setAgentSessionStatus(token, { ...target, status: 'processing' }),
    ]);
    if (results.some((r) => r.status === 'fulfilled')) {
      nativeBlocked.delete(token);
      return true;
    }
    nativeBlocked.set(token, now());
    logger.debug(
      { err: results.map((r) => r.reason?.message) },
      'slack: native status unavailable, using a message'
    );
    return false;
  }

  /** Shows the native status and keeps its text current; false when Slack refuses it. */
  async function showNative(row, slackApp, { state } = {}) {
    const current = nativeShown.get(row.id);
    const sinceLast = current ? now() - current.at : Infinity;
    if (sinceLast < REFRESH_MS) return true;
    const text = nativeStatusText({
      state,
      activity: await currentActivity(row.session_id),
      elapsedMs: current ? now() - current.since : 0,
    });
    if (current && text === current.text && sinceLast < NATIVE_REFRESH_MS) return true;
    if (!(await setNative(row, slackApp, text))) {
      nativeShown.delete(row.id);
      return false;
    }
    nativeShown.set(row.id, { text, at: now(), since: current?.since ?? now() });
    return true;
  }

  /** Clears the status line and puts the agent back to `active`: ready for the next message. */
  async function clearNative(row, slackApp) {
    nativeShown.delete(row.id);
    pending.delete(row.id);
    const target = { channel: row.channel_id, threadTs: row.thread_ts };
    const token = slackApp.bot_token;
    const results = await Promise.allSettled([
      setThreadStatus(token, { ...target, status: '' }),
      setAgentSessionStatus(token, { ...target, status: 'active' }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.debug({ err: r.reason?.message }, 'slack: failed to clear native status');
      }
    }
  }

  async function post(row, slackApp, text) {
    const ts = await say(slackApp, row.channel_id, row.thread_ts, text);
    if (!ts) return null;
    await threads().setLoader(row.id, ts);
    const at = now();
    shown.set(row.id, { text, at, since: at });
    return ts;
  }

  async function remove(row, slackApp) {
    pending.delete(row.id);
    shown.delete(row.id);
    await threads().setLoader(row.id, null);
    await deleteMessage(slackApp.bot_token, { channel: row.channel_id, ts: row.status_ts }).catch(
      (err) => logger.debug({ err: err.message }, 'slack: failed to remove loader')
    );
  }

  /** Keeps a visible loader's text current — at once for a new phase, else every few seconds. */
  async function refresh(row, slackApp, state, { phaseChanged }) {
    const current = shown.get(row.id) ?? { text: null, at: 0, since: now() };
    const elapsedMs = now() - current.since;
    if (!phaseChanged && now() - current.at < REFRESH_MS) return;
    const text = loaderText({
      state,
      activity: await currentActivity(row.session_id),
      elapsedMs,
    });
    if (text === current.text) return;
    try {
      await updateMessage(slackApp.bot_token, { channel: row.channel_id, ts: row.status_ts, text });
      shown.set(row.id, { ...current, text, at: now() });
    } catch (err) {
      logger.debug({ err: err.message }, 'slack: failed to refresh loader');
    }
  }

  async function syncRow(staleRow, slackApp, { settled }) {
    // Re-read: another update may have shown or removed the loader since the list was loaded.
    const row = await db()('slack_threads').where({ id: staleRow.id }).first();
    if (!row) return;
    const state = await sessionState(row.session_id);
    const wait = pending.get(row.id);
    if (state && wait) wait.sawWorking = true;
    const waitingToStart =
      !state && wait && !wait.sawWorking && !settled && now() - wait.since < START_GRACE_MS;
    const visible = Boolean(state) || waitingToStart;
    const native = nativeShown.get(row.id);

    if (visible && !row.status_ts) {
      if (await showNative(row, slackApp, { state })) return;
      await post(row, slackApp, loaderText({ state, elapsedMs: 0 }));
    } else if (visible) {
      const phaseChanged = Boolean(state) && shown.get(row.id)?.state !== state;
      await refresh(row, slackApp, state, { phaseChanged });
      if (state) shown.set(row.id, { ...shown.get(row.id), state });
    } else {
      if (native) await clearNative(row, slackApp);
      if (row.status_ts) await remove(row, slackApp);
    }
  }

  /** Each thread's active binding, plus any row still showing a loader. */
  function candidateRows(sessionId) {
    const query = db()('slack_threads').where(function () {
      this.whereIn('id', function () {
        this.max('id').from('slack_threads').groupBy('slack_app_id', 'channel_id', 'thread_ts');
      }).orWhereNotNull('status_ts');
    });
    if (sessionId != null) return query.where({ session_id: sessionId });
    const since = sqliteTimestamp(new Date(Date.now() - LOOKBACK_DAYS * 86_400_000));
    return query.where('created_at', '>', since);
  }

  /** Runs `work` for a row unless another update of it is in flight. */
  async function exclusively(row, work) {
    if (busyRows.has(row.id)) return;
    busyRows.add(row.id);
    try {
      await work();
    } catch (err) {
      logger.debug({ err: err.message, sessionId: row.session_id }, 'slack: loader sync failed');
    } finally {
      busyRows.delete(row.id);
    }
  }

  /**
   * Shows, updates or removes loaders — for one session, or (no argument) every recent thread.
   * `settled`: the turn is over (finished or stopped), so don't wait for it to start.
   */
  async function syncLoaders(sessionId = null, { settled = false } = {}) {
    const [rows, apps] = await Promise.all([candidateRows(sessionId), loadApps()]);
    for (const row of rows) {
      const slackApp = apps.find((app) => app.id === row.slack_app_id);
      if (!slackApp?.bot_token) continue;
      await exclusively(row, () => syncRow(row, slackApp, { settled }));
    }
  }

  /**
   * Shows the loader right away for a message that is about to reach the session, before the
   * agent has started — the first thing people see after sending it.
   */
  async function showNow(thread, slackApp) {
    pending.set(thread.id, { since: now(), sawWorking: false });
    if (thread.status_ts || nativeShown.has(thread.id)) return;
    await exclusively(thread, async () => {
      const row = await db()('slack_threads').where({ id: thread.id }).first();
      if (!row || row.status_ts) return;
      if (await showNative(row, slackApp)) return;
      await post(row, slackApp, loaderText({ elapsedMs: 0 }));
    });
  }

  return { syncLoaders, showNow };
}

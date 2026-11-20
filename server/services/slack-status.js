/**
 * The "Baguette is cooking…" indicator under a Slack thread while the global session works on a
 * message from it: Slack's native status line (`assistant.threads.setStatus`) and the agent state
 * `processing`, which adds a Stop button once the app subscribes to `agent_session_stopped`.
 * Slack may refuse either (missing scope or feature); the indicator is a nicety, so that is
 * only logged.
 */
import logger from '../logger.js';
import { setAgentSessionStatus, setThreadStatus } from './slack.js';

const WORKING_STATUS = 'is cooking… 🥖';

export function createSlackStatus() {
  /** sessionId → the threads currently showing the indicator, by `channel:threadTs`. */
  const shown = new Map();

  /** Runs both Slack calls; each may fail on its own. */
  async function apply(slackApp, { channel, threadTs }, { status, agentState }) {
    const results = await Promise.allSettled([
      setThreadStatus(slackApp.bot_token, { channel, threadTs, status }),
      setAgentSessionStatus(slackApp.bot_token, { channel, threadTs, status: agentState }),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.debug({ err: result.reason?.message }, 'slack: status update refused');
      }
    }
  }

  /** Shows the indicator in a thread while the global session works on a message from it. */
  async function show(sessionId, slackApp, target) {
    const threads = shown.get(sessionId) ?? new Map();
    threads.set(`${target.channel}:${target.threadTs}`, { slackApp, target });
    shown.set(sessionId, threads);
    await apply(slackApp, target, { status: WORKING_STATUS, agentState: 'processing' });
  }

  /** Removes the indicator from every thread of the session and readies the agent again. */
  async function clear(sessionId) {
    const threads = shown.get(sessionId);
    shown.delete(sessionId);
    if (!threads) return;
    await Promise.all(
      [...threads.values()].map(({ slackApp, target }) =>
        apply(slackApp, target, { status: '', agentState: 'active' })
      )
    );
  }

  return { show, clear };
}

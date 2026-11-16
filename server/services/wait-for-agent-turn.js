import { NotFound } from 'feathers/errors';
import {
  AGENT_TURN_WAIT_TIMEOUT_MS,
  agentTurnWaitTimeoutMessage,
} from '../../shared/mcp-await-timeout.js';
import { getAgentById } from './agents-db.js';

/**
 * Poll until the agent is no longer running (or a terminal status is reached).
 * @param {import('knex').Knex} db
 * @param {number} agentId
 * @param {{
 *   timeoutMs?: number | null,
 *   intervalMs?: number,
 *   timeoutMessage?: (agent: object) => string,
 * }} opts - pass `timeoutMs: null` to wait without a limit; `timeoutMessage` customizes
 *   the timeout error text (the error carries `isTurnWaitTimeout` so callers can
 *   distinguish timeouts from other failures).
 */
export async function waitForAgentTurnEnd(
  db,
  agentId,
  { timeoutMs = AGENT_TURN_WAIT_TIMEOUT_MS, intervalMs = 500, timeoutMessage } = {}
) {
  const hasTimeout = timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0;
  const started = Date.now();
  for (;;) {
    const agent = await getAgentById(db, agentId);
    if (!agent) throw new NotFound('Agent not found');
    if (agent.status !== 'running') {
      return agent;
    }
    if (hasTimeout && Date.now() - started >= timeoutMs) {
      const message = timeoutMessage ? timeoutMessage(agent) : agentTurnWaitTimeoutMessage(agent);
      const err = new Error(message);
      err.isTurnWaitTimeout = true;
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

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
 * @param {{ timeoutMs?: number | null, intervalMs?: number }} opts - pass `timeoutMs: null` to wait without a limit
 */
export async function waitForAgentTurnEnd(
  db,
  agentId,
  { timeoutMs = AGENT_TURN_WAIT_TIMEOUT_MS, intervalMs = 500 } = {}
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
      throw new Error(agentTurnWaitTimeoutMessage(agent));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

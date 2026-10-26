import { NotFound } from 'feathers/errors';
import { getAgentById } from './agents-db.js';

/**
 * Poll until the agent is no longer running (or a terminal status is reached).
 * @param {import('knex').Knex} db
 * @param {number} agentId
 * @param {{ timeoutMs?: number, intervalMs?: number }} opts
 */
export async function waitForAgentTurnEnd(
  db,
  agentId,
  { timeoutMs = 600_000, intervalMs = 500 } = {}
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const agent = await getAgentById(db, agentId);
    if (!agent) throw new NotFound('Agent not found');
    if (agent.status !== 'running') {
      return agent;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for agent to finish');
}

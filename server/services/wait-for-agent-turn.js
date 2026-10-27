import { NotFound } from 'feathers/errors';
import { getAgentById } from './agents-db.js';

/** Default wall-clock limit for StartSubagent (attach) and AwaitSubagent. */
export const AGENT_TURN_WAIT_TIMEOUT_MS = 3_600_000;

/**
 * @param {{ id?: number, ref?: number } | null | undefined} agent
 */
export function agentTurnWaitTimeoutMessage(agent) {
  const idPart = agent?.id != null ? `agent_id ${agent.id}` : 'the subagent';
  const refPart = agent?.ref != null ? `, ref ${agent.ref}` : '';
  const minutes = AGENT_TURN_WAIT_TIMEOUT_MS / 60_000;
  return (
    `Timed out after ${minutes} minutes waiting for ${idPart}${refPart} to finish. ` +
    'The subagent may still be running. Read its last assistant message in the session ' +
    '(GetSessionMessages for that agent) to judge progress, then call AwaitSubagent again to keep waiting or StopSubagent to cancel.'
  );
}

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

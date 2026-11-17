import { patchAgentInternal } from './feathers/agents.service.js';
import { getAgentById } from './agents-db.js';
import logger from '../logger.js';
import { notifyAgentObservers } from './agent-observers-notify.js';
import { ensureFailedTurnResult } from './agent-error-message.js';

export async function setAgentTurnRunning(app, agent, userId) {
  if (!agent?.id || agent.status === 'running') return;
  await patchAgentInternal(app, agent.id, { status: 'running' }, userId);
}

/**
 * Patch an agent to a terminal turn status.
 *
 * `failed` guarantees a `turn_result` error row (explicit text, or the latest
 * already-persisted one) so observers and GetSessionStatus can surface the cause.
 *
 * @param {import('feathers').Application} app
 * @param {object} agent
 * @param {number} userId
 * @param {'completed' | 'failed' | 'stopped' | 'approval'} status
 * @param {{ error_message?: unknown }} [opts]
 */
export async function setAgentTurnTerminal(app, agent, userId, status, { error_message } = {}) {
  if (!agent?.id) return;
  const isTurnEnd = status === 'completed' || status === 'failed';
  const db = app.get('db');
  const row = await getAgentById(db, agent.id);

  const patch = { status, active_turn_id: null };
  let resolvedError = null;
  if (status === 'failed') {
    resolvedError = await ensureFailedTurnResult(
      app,
      {
        ...(row ?? agent),
        active_turn_id: agent.active_turn_id ?? row?.active_turn_id ?? null,
      },
      userId,
      error_message
    );
  }

  await patchAgentInternal(app, agent.id, patch, userId);

  if (row && isTurnEnd) {
    try {
      await notifyAgentObservers(app, { ...row, ...patch, error_message: resolvedError }, userId, {
        status,
      });
    } catch (err) {
      logger.warn(
        { agentId: agent.id, err: err?.message },
        'Failed to notify agent observers of turn end'
      );
    }
  }
}

export async function setAgentActiveTurnId(app, agent, userId, turnId) {
  if (!agent?.id || turnId == null) return;
  await patchAgentInternal(app, agent.id, { active_turn_id: turnId }, userId);
}

export async function clearAgentActiveTurnId(app, agent, userId) {
  if (!agent?.id) return;
  await patchAgentInternal(app, agent.id, { active_turn_id: null }, userId);
}

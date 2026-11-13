import { patchAgentInternal } from './feathers/agents.service.js';
import { getAgentById } from './agents-db.js';
import logger from '../logger.js';
import { notifyParentOfFinishedSubagent } from './agent-subagent-notify.js';

export async function setAgentTurnRunning(app, agent, userId) {
  if (!agent?.id || agent.status === 'running') return;
  await patchAgentInternal(app, agent.id, { status: 'running' }, userId);
}

export async function setAgentTurnTerminal(app, agent, userId, status) {
  if (!agent?.id) return;
  const isTurnEnd = status === 'completed' || status === 'failed';
  const row = isTurnEnd ? await getAgentById(app.get('db'), agent.id) : null;

  await patchAgentInternal(app, agent.id, { status, active_turn_id: null }, userId);

  if (row?.notify_parent && row.agent_type === 'subagent' && isTurnEnd) {
    try {
      await notifyParentOfFinishedSubagent(app, row, userId, status);
    } catch (err) {
      logger.warn(
        { agentId: agent.id, err: err?.message },
        'Failed to notify parent of subagent result'
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

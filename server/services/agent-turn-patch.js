import { patchAgentInternal } from './feathers/agents.service.js';

export async function setAgentTurnRunning(app, agent, userId) {
  if (!agent?.id || agent.status === 'running') return;
  await patchAgentInternal(app, agent.id, { status: 'running' }, userId);
}

export async function setAgentTurnTerminal(app, agent, userId, status) {
  if (!agent?.id) return;
  await patchAgentInternal(app, agent.id, { status, active_turn_id: null }, userId);
}

export async function setAgentActiveTurnId(app, agent, userId, turnId) {
  if (!agent?.id || turnId == null) return;
  await patchAgentInternal(app, agent.id, { active_turn_id: turnId }, userId);
}

export async function clearAgentActiveTurnId(app, agent, userId) {
  if (!agent?.id) return;
  await patchAgentInternal(app, agent.id, { active_turn_id: null }, userId);
}

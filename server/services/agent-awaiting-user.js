/** Agent turn status while waiting for AskUserQuestions or plan confirmation. */
const AGENT_AWAITING_USER_STATUS = 'approval';

/**
 * @param {import('feathers').Application} app
 * @param {number} agentId
 * @param {number} userId
 */
async function markBuilderAgentAwaitingUser(app, agentId, userId) {
  if (!agentId || !userId) return;
  const { patchAgentInternal } = await import('./feathers/agents.service.js');
  await patchAgentInternal(app, agentId, { status: AGENT_AWAITING_USER_STATUS }, userId);
}

/**
 * @param {{ status?: string | null } | null | undefined} agent
 */
export function isBuilderAgentAwaitingUser(agent) {
  return agent?.status === AGENT_AWAITING_USER_STATUS;
}

/**
 * After AskUserQuestions / CreatePlan / EditPlan (when interactive is not false): mark the agent awaiting user input.
 * Does not abort or cancel the agent — the model should end the turn on its own.
 *
 * @param {import('feathers').Application} app
 * @param {number} _sessionId
 * @param {number} userId
 * @param {{ endTurnAwaitingUser?: boolean; agentId?: number } | null | undefined} sessionState
 */
export async function markAwaitingUserAfterTurnEndingTool(app, _sessionId, userId, sessionState) {
  if (!sessionState) return;
  sessionState.endTurnAwaitingUser = true;
  const agentId = sessionState.agentId;
  if (agentId) {
    await markBuilderAgentAwaitingUser(app, agentId, userId);
  }
}

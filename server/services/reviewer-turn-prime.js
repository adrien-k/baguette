import { isGlobalSession } from '../../shared/session-scope.js';
import { BadRequest } from 'feathers/errors';
import { getReviewAgentTurn, reviewTurnKey, buildReviewStartMessage } from './review-agent-turn.js';
import { patchAgentInternal } from './feathers/agents.service.js';
import { getAgentById } from './agents-db.js';

async function assertSessionCanReview(session) {
  if (isGlobalSession(session)) {
    throw new BadRequest('Reviews are only available on repository sessions');
  }
  if (!session.session_path) {
    throw new BadRequest('Session worktree is not ready');
  }
}

/** After external `agents.create` for a reviewer: first user message + turn start. */
export async function dispatchReviewerAfterCreate(app, agent, session, createData, user) {
  await assertSessionCanReview(session);
  const reviewTurn = getReviewAgentTurn(app);
  reviewTurn.setTurnExtras(session.id, {
    extraPrompt: createData.extra_prompt,
  });
  app.service('sessions').resetClaudeUsageTotals(reviewTurnKey(agent.id));
  await patchAgentInternal(
    app,
    agent.id,
    {
      status: 'running',
      claude_session_id: null,
      cursor_agent_id: null,
      pi_session_id: null,
      active_turn_id: null,
    },
    session.user_id
  );
  await app.service('sessions').onTurnStart(session.id);
  const { persist: startMessage } = buildReviewStartMessage({
    user_message: createData.initial_prompt ?? agent.initial_prompt,
    initial_prompt: agent.initial_prompt,
  });
  const row = {
    session_id: session.id,
    type: startMessage.type,
    subtype: startMessage.subtype ?? null,
    message_json: JSON.stringify(startMessage),
    agent_id: agent.id,
    agent_sdk: agent.agent_sdk,
    model: agent.model,
    ...(agent.model_params != null ? { model_params: agent.model_params } : {}),
    ...(agent.agent_config_id != null ? { agent_config_id: agent.agent_config_id } : {}),
  };
  await app.service('messages').create(row, {
    provider: undefined,
    user: { id: user.id },
  });
}

/** Before persisting a reviewer user message: mark the reviewer running for this turn. */
export async function primeReviewerUserMessageCreate(app, context) {
  if (context.result?.queued) return context;
  const data = context.data;
  if (!data || data.type !== 'user' || data.agent_id == null) return context;
  const db = app.get('db');
  const agent = await getAgentById(db, data.agent_id);
  if (!agent || agent.agent_type !== 'reviewer') return context;
  const session = await db('sessions').where({ id: data.session_id }).first();
  if (!session) return context;
  await assertSessionCanReview(session);
  if (agent.status === 'running') return context;

  await patchAgentInternal(
    app,
    agent.id,
    { status: 'running', active_turn_id: null },
    session.user_id
  );
  await app.service('sessions').onTurnStart(session.id);
  return context;
}

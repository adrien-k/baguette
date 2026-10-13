/** Insert a session row and its primary builder agent (post-migration 061 shape). */
export async function insertSessionWithPrimaryBuilder(db, sessionFields) {
  const {
    agent_config_id,
    agent_sdk,
    model,
    model_params,
    claude_session_id,
    cursor_agent_id,
    pi_session_id,
    status: sessionStatus = 'stopped',
    ...sessionOnly
  } = sessionFields;
  const [sessionId] = await db('sessions').insert({ ...sessionOnly, status: sessionStatus });
  await db('agents').insert({
    session_id: sessionId,
    name: 'Builder',
    agent_type: 'builder',
    is_primary: 1,
    status: sessionStatus === 'running' ? 'running' : 'stopped',
    agent_config_id: agent_config_id ?? null,
    agent_sdk: agent_sdk ?? 'claude',
    model: model ?? 'sonnet',
    model_params: model_params ?? null,
    claude_session_id: claude_session_id ?? null,
    cursor_agent_id: cursor_agent_id ?? null,
    pi_session_id: pi_session_id ?? null,
    current_turn_id: 0,
  });
  return sessionId;
}

export async function getPrimaryBuilderForSession(db, sessionId) {
  return db('agents').where({ session_id: sessionId, is_primary: 1 }).first();
}

export async function getReviewerForSession(db, sessionId) {
  return db('agents').where({ session_id: sessionId, agent_type: 'reviewer' }).first();
}

export async function reviewerStatusForSession(db, sessionId) {
  const row = await getReviewerForSession(db, sessionId);
  return row?.status ?? null;
}

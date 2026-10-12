/** Session status while the agent waits for AskUserQuestions or plan confirmation. */
const SESSION_AWAITING_USER_STATUS = 'approval';

/**
 * @param {import('@feathersjs/feathers').Application} app
 * @param {number} sessionId
 * @param {number} userId
 */
async function markSessionAwaitingUser(app, sessionId, userId) {
  if (!sessionId || !userId) return;
  await app
    .service('sessions')
    .patch(
      sessionId,
      { status: SESSION_AWAITING_USER_STATUS },
      { provider: undefined, user: { id: userId } }
    );
}

/**
 * @param {{ status?: string | null } | null | undefined} session
 */
export function isSessionAwaitingUser(session) {
  return session?.status === SESSION_AWAITING_USER_STATUS;
}

/**
 * After AskUserQuestions / CreatePlan / EditPlan: mark the session awaiting user input.
 * Does not abort or cancel the agent — the model should end the turn on its own.
 *
 * @param {import('@feathersjs/feathers').Application} app
 * @param {number} sessionId
 * @param {number} userId
 * @param {{ endTurnAwaitingUser?: boolean } | null | undefined} sessionState
 */
export async function markAwaitingUserAfterTurnEndingTool(app, sessionId, userId, sessionState) {
  if (!sessionState) return;
  sessionState.endTurnAwaitingUser = true;
  await markSessionAwaitingUser(app, sessionId, userId);
}

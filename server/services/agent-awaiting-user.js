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
 * End a builder chat turn after AskUserQuestions / CreatePlan / EditPlan.
 *
 * @param {import('@feathersjs/feathers').Application} app
 * @param {{ channel?: string; turnChannel?: string; userId: number; endTurnAwaitingUser?: boolean } | null | undefined} sessionState
 * @param {number} sessionId
 * @param {(state: NonNullable<typeof sessionState>) => void | Promise<void>} stopActiveTurn
 */
export async function endBuilderTurnAwaitingUser(app, sessionState, sessionId, stopActiveTurn) {
  if (!sessionState) return;
  const channel = sessionState.channel ?? sessionState.turnChannel ?? 'chat';
  if (channel === 'review') return;

  sessionState.endTurnAwaitingUser = true;
  await markSessionAwaitingUser(app, sessionId, sessionState.userId);

  try {
    await stopActiveTurn(sessionState);
  } catch {
    // turn may already be idle
  }
}

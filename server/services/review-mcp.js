import { BadRequest, NotFound } from 'feathers/errors';
import { getAgentById, getReviewerAgent } from './agents-db.js';
import { isGlobalSession } from '../../shared/session-scope.js';

function isReviewerTurnActive(agent) {
  if (!agent) return false;
  return agent.status === 'running' || agent.status === 'approval';
}

export async function assertReviewNotInProgress(db, sessionId) {
  const reviewer = await getReviewerAgent(db, sessionId);
  if (reviewer && isReviewerTurnActive(reviewer)) {
    throw new BadRequest('A review is already in progress');
  }
  return reviewer;
}

/**
 * Review notify_parent may only wake an observer in the reviewed session or a global orchestrator
 * (same rule as WatchSession / CreateSession notify_parent).
 */
export async function assertReviewNotifyObserver(
  db,
  { reviewedSessionId, observerAgentId, userId }
) {
  const observer = await getAgentById(db, observerAgentId);
  if (!observer) throw new BadRequest('Observer agent not found');
  const observerSession = await db('sessions')
    .where({ id: observer.session_id, user_id: userId })
    .first();
  if (!observerSession) throw new BadRequest('Observer agent not found');
  const reviewedSession = await db('sessions')
    .where({ id: reviewedSessionId, user_id: userId })
    .first();
  if (!reviewedSession) throw new NotFound('Session not found');
  const sameSession = observer.session_id === reviewedSessionId;
  if (!sameSession && !isGlobalSession(observerSession)) {
    throw new BadRequest(
      'Review notify_parent only allows an observer in the reviewed session, or a global orchestrator session.'
    );
  }
}

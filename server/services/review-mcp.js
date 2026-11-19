import { BadRequest } from 'feathers/errors';
import { getReviewerAgent } from './agents-db.js';

export function isReviewerTurnActive(agent) {
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

import { combinePromptExtensions } from '../../shared/agent-prompts.js';
import { loadBaguetteAgentPrompt } from './baguette-config.js';

/**
 * @param {string|null|undefined} sessionPath
 * @param {string} [extraPrompt]
 */
export async function getEffectiveReviewPrompt(sessionPath, extraPrompt = '') {
  const repo = sessionPath ? await loadBaguetteAgentPrompt(sessionPath, 'reviewer') : null;
  return combinePromptExtensions(repo ?? '', extraPrompt);
}

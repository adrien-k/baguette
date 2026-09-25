import loadPrompt from '../prompts/loadPrompt.js';
import { isGlobalSession } from '../../shared/session-scope.js';

/**
 * Builds the full system prompt append string for a builder session.
 * Returns the rendered build-prompt.md template with all variables substituted.
 */
async function renderBasePromptForSession(agentPrompt = '') {
  const base = await loadPrompt('base-prompt', {});
  const extra = agentPrompt?.trim()
    ? `\n\n## Additional instructions\n\n${agentPrompt.trim()}\n`
    : '';
  return base + extra;
}

export async function buildSystemPromptAppend(sessionRow, { agentPrompt = '' } = {}) {
  if (isGlobalSession(sessionRow)) {
    return loadPrompt('global-prompt', {});
  }

  return loadPrompt('build-prompt', {
    base_prompt: await renderBasePromptForSession(agentPrompt),
  });
}

/** Uninterpolated base-prompt.md for Settings (readonly base). */
export async function loadBaseSessionPromptTemplate() {
  return loadPrompt('base-prompt', {});
}

/** Full build-prompt.md for Settings with base-prompt.md embedded (no user extension). */
export async function loadFullSessionPromptTemplate() {
  const basePrompt = await loadBaseSessionPromptTemplate();
  return loadPrompt('build-prompt', {
    base_prompt: basePrompt,
  });
}

/**
 * System prompt append for a one-off review turn (not a session agent).
 */
export async function buildReviewSystemPromptAppend(sessionRow, userReviewPrompt = '') {
  const extra = userReviewPrompt?.trim()
    ? `## Additional review instructions\n\n${userReviewPrompt.trim()}\n`
    : '';
  return loadPrompt('review-prompt', {
    user_review_prompt: extra,
    base_prompt: await loadPrompt('base-prompt', {}),
  });
}

/** Full review-prompt.md for Settings with base-prompt.md embedded (no user extension). */
export async function loadFullReviewPromptTemplate() {
  const basePrompt = await loadPrompt('base-prompt', {});
  return loadPrompt('review-prompt', {
    user_review_prompt: '',
    base_prompt: basePrompt,
  });
}

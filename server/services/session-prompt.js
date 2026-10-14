import loadPrompt from '../prompts/loadPrompt.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { combinePromptExtensions } from '../../shared/agent-prompts.js';
import { loadBaguetteInstructions } from './baguette-config.js';

/**
 * Builds the full system prompt append string for a builder session.
 * Returns the rendered build-prompt.md template with all variables substituted.
 */
async function renderBasePromptForSession(agentPrompt = '', sessionPath = null) {
  const base = await loadPrompt('base-prompt', {});
  const repoInstructions = sessionPath ? await loadBaguetteInstructions(sessionPath) : null;
  const combined = combinePromptExtensions(agentPrompt, repoInstructions ?? '');
  const extra = combined ? `\n\n## Additional instructions\n\n${combined}\n` : '';
  return base + extra;
}

/** @param {{ is_primary?: number | boolean | null }} [agent] */
function isPrimaryBuilderAgent(agent) {
  if (!agent) return true;
  return Boolean(Number(agent.is_primary));
}

export async function buildSystemPromptAppend(sessionRow, { agentPrompt = '', agent = null } = {}) {
  if (isGlobalSession(sessionRow)) {
    return loadPrompt('global-prompt', {});
  }

  const sessionPath = sessionRow?.session_path ?? null;
  const rolePromptName = isPrimaryBuilderAgent(agent)
    ? 'primary-builder-role-prompt'
    : 'secondary-builder-role-prompt';
  const primary = isPrimaryBuilderAgent(agent);
  const builderRolePrompt = await loadPrompt(rolePromptName, {});
  const repoConfigPrompt = primary ? await loadPrompt('build-prompt-repo-config-prompt', {}) : '';
  return loadPrompt('build-prompt', {
    base_prompt: await renderBasePromptForSession(agentPrompt, sessionPath),
    builder_role_prompt: builderRolePrompt,
    repo_config_prompt: repoConfigPrompt,
  });
}

/** Uninterpolated base-prompt.md for Settings (readonly base). */
async function loadBaseSessionPromptTemplate() {
  return loadPrompt('base-prompt', {});
}

/** Full build-prompt.md for Settings (primary builder; no user extension). */
export async function loadFullSessionPromptTemplate() {
  const basePrompt = await loadBaseSessionPromptTemplate();
  const builderRolePrompt = await loadPrompt('primary-builder-role-prompt', {});
  const repoConfigPrompt = await loadPrompt('build-prompt-repo-config-prompt', {});
  return loadPrompt('build-prompt', {
    base_prompt: basePrompt,
    builder_role_prompt: builderRolePrompt,
    repo_config_prompt: repoConfigPrompt,
  });
}

/** Full build-prompt.md for Settings (secondary / extra builders; no user extension). */
export async function loadFullSecondaryBuilderPromptTemplate() {
  const basePrompt = await loadBaseSessionPromptTemplate();
  const builderRolePrompt = await loadPrompt('secondary-builder-role-prompt', {});
  return loadPrompt('build-prompt', {
    base_prompt: basePrompt,
    builder_role_prompt: builderRolePrompt,
    repo_config_prompt: '',
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

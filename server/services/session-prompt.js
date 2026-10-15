import loadPrompt from '../prompts/loadPrompt.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { combinePromptExtensions } from '../../shared/agent-prompts.js';
import { loadBaguetteAgentPrompt } from './baguette-config.js';

/** @param {{ agent_type?: string | null }} [agent] */
function buildPromptRole(agent) {
  if (agent?.agent_type === 'subagent') return 'subagent';
  return 'builder';
}

/**
 * Builds the full system prompt append string for a builder session.
 * Returns the rendered build-prompt.md template with all variables substituted.
 */
async function renderBasePromptForSession(sessionPath, role) {
  const base = await loadPrompt('base-prompt', {});
  const roleExtension = sessionPath ? await loadBaguetteAgentPrompt(sessionPath, role) : null;
  const combined = combinePromptExtensions(roleExtension ?? '');
  const extra = combined ? `\n\n## Additional instructions\n\n${combined}\n` : '';
  return base + extra;
}

export async function buildSystemPromptAppend(sessionRow, { agent = null } = {}) {
  if (isGlobalSession(sessionRow)) {
    return loadPrompt('global-prompt', {});
  }

  const sessionPath = sessionRow?.session_path ?? null;
  const role = buildPromptRole(agent);
  const rolePromptName = role === 'subagent' ? 'subagent-role-prompt' : 'builder-role-prompt';
  const builderRolePrompt = await loadPrompt(rolePromptName, {});
  const repoConfigPrompt =
    role === 'builder' ? await loadPrompt('build-prompt-repo-config-prompt', {}) : '';
  const builderEndOfTurnPrompt =
    role === 'builder' ? await loadPrompt('builder-end-of-turn-prompt', {}) : '';
  const buildTemplate = role === 'subagent' ? 'subagent-build-prompt' : 'build-prompt';
  const templateVars = {
    base_prompt: await renderBasePromptForSession(sessionPath, role),
    builder_role_prompt: builderRolePrompt,
  };
  if (buildTemplate === 'build-prompt') {
    templateVars.repo_config_prompt = repoConfigPrompt;
    templateVars.builder_end_of_turn_prompt = builderEndOfTurnPrompt;
  }
  return loadPrompt(buildTemplate, templateVars);
}

/** Uninterpolated base-prompt.md for Settings (readonly base). */
async function loadBaseSessionPromptTemplate() {
  return loadPrompt('base-prompt', {});
}

/** Full build-prompt.md for Settings (builder; no repo extension). */
export async function loadFullSessionPromptTemplate() {
  const basePrompt = await loadBaseSessionPromptTemplate();
  const builderRolePrompt = await loadPrompt('builder-role-prompt', {});
  const repoConfigPrompt = await loadPrompt('build-prompt-repo-config-prompt', {});
  const builderEndOfTurnPrompt = await loadPrompt('builder-end-of-turn-prompt', {});
  return loadPrompt('build-prompt', {
    base_prompt: basePrompt,
    builder_role_prompt: builderRolePrompt,
    repo_config_prompt: repoConfigPrompt,
    builder_end_of_turn_prompt: builderEndOfTurnPrompt,
  });
}

/** Full build-prompt.md for Settings (subagent; no repo extension). */
export async function loadFullSubagentPromptTemplate() {
  const basePrompt = await loadBaseSessionPromptTemplate();
  const builderRolePrompt = await loadPrompt('subagent-role-prompt', {});
  return loadPrompt('subagent-build-prompt', {
    base_prompt: basePrompt,
    builder_role_prompt: builderRolePrompt,
  });
}

/**
 * System prompt append for a one-off review turn (not a session agent).
 */
export async function buildReviewSystemPromptAppend(sessionRow, userReviewPrompt = '') {
  const sessionPath = sessionRow?.session_path ?? null;
  const repoReview = sessionPath ? await loadBaguetteAgentPrompt(sessionPath, 'reviewer') : null;
  const combined = combinePromptExtensions(repoReview ?? '', userReviewPrompt?.trim() ?? '');
  const extra = combined ? `## Additional review instructions\n\n${combined}\n` : '';
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

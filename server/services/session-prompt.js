import loadPrompt from '../prompts/loadPrompt.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { combinePromptExtensions } from '../../shared/agent-prompts.js';
import { repoAccessMode } from '../../shared/repo-origin.js';
import { loadBaguetteAgentPrompt } from './baguette-config.js';

const PR_METADATA_HINT_GITHUB =
  'Use **`UpdateSession`** to change label and description; for pull request title, URL, and description on GitHub, call **`PrRead`**.';

const PR_METADATA_HINT_NO_API =
  'Use **`UpdateSession`** to change label and description. **`CurrentSessionInfo`** and **`UpdateSession`** are the source of title and description for this session.';

const SUBAGENT_SESSION_TOOLS_GITHUB =
  '**`CurrentSessionInfo`**, **`PrRead`**, **`GitPull`**, **`GitFetch`**';

const SUBAGENT_SESSION_TOOLS_LOCAL = '**`CurrentSessionInfo`**';

/** @param {{ agent_type?: string | null }} [agent] */
function buildPromptRole(agent) {
  if (agent?.agent_type === 'subagent') return 'subagent';
  return 'builder';
}

/**
 * Snippet names / one-liners for this session's git remote.
 * Defaults to github (Settings preview and callers that omit repo).
 */
function promptSnippetsForAccess(accessMode = 'github') {
  if (accessMode === 'local') {
    return {
      gitRemote: 'git-remote-local',
      endOfTurn: 'builder-end-of-turn-local',
      prMetadataHint: PR_METADATA_HINT_NO_API,
      subagentSessionTools: SUBAGENT_SESSION_TOOLS_LOCAL,
    };
  }
  return {
    gitRemote: 'git-remote-github',
    endOfTurn: 'builder-end-of-turn-prompt',
    prMetadataHint: PR_METADATA_HINT_GITHUB,
    subagentSessionTools: SUBAGENT_SESSION_TOOLS_GITHUB,
  };
}

async function resolveRepoRow(sessionRow, { repo = null, db = null } = {}) {
  if (repo) return repo;
  if (!sessionRow?.repo_id || !db) return null;
  return db('repos').where({ id: sessionRow.repo_id }).first();
}

function accessModeFromRepo(repo) {
  if (!repo) return 'github';
  return repoAccessMode(repo);
}

/**
 * Builds the full system prompt append string for a builder session.
 * Returns the rendered build-prompt.md template with all variables substituted.
 */
async function renderBasePromptForSession(sessionPath, role, { prMetadataHint } = {}) {
  const base = await loadPrompt('base-prompt', {
    session_pr_metadata_hint: prMetadataHint ?? PR_METADATA_HINT_GITHUB,
  });
  const roleExtension = sessionPath ? await loadBaguetteAgentPrompt(sessionPath, role) : null;
  const combined = combinePromptExtensions(roleExtension ?? '');
  const extra = combined ? `\n\n## Additional instructions\n\n${combined}\n` : '';
  return base + extra;
}

async function loadRoleAndEndOfTurn(role, snippets) {
  const gitRemotePrompt = await loadPrompt(snippets.gitRemote, {});
  const rolePromptName = role === 'subagent' ? 'subagent-role-prompt' : 'builder-role-prompt';
  const builderRolePrompt = await loadPrompt(rolePromptName, {
    git_remote_prompt: gitRemotePrompt,
    subagent_session_tools: snippets.subagentSessionTools,
  });
  const repoConfigPrompt =
    role === 'builder' ? await loadPrompt('build-prompt-repo-config-prompt', {}) : '';
  const builderEndOfTurnPrompt = role === 'builder' ? await loadPrompt(snippets.endOfTurn, {}) : '';
  return { builderRolePrompt, repoConfigPrompt, builderEndOfTurnPrompt };
}

export async function buildSystemPromptAppend(
  sessionRow,
  { agent = null, repo = null, db = null } = {}
) {
  if (isGlobalSession(sessionRow)) {
    return loadPrompt('global-prompt', {});
  }

  const repoRow = await resolveRepoRow(sessionRow, { repo, db });
  const snippets = promptSnippetsForAccess(accessModeFromRepo(repoRow));

  const sessionPath = sessionRow?.session_path ?? null;
  const role = buildPromptRole(agent);
  const { builderRolePrompt, repoConfigPrompt, builderEndOfTurnPrompt } =
    await loadRoleAndEndOfTurn(role, snippets);
  const buildTemplate = role === 'subagent' ? 'subagent-build-prompt' : 'build-prompt';
  const templateVars = {
    base_prompt: await renderBasePromptForSession(sessionPath, role, {
      prMetadataHint: snippets.prMetadataHint,
    }),
    builder_role_prompt: builderRolePrompt,
    subagent_session_tools: snippets.subagentSessionTools,
  };
  if (buildTemplate === 'build-prompt') {
    templateVars.repo_config_prompt = repoConfigPrompt;
    templateVars.builder_end_of_turn_prompt = builderEndOfTurnPrompt;
  }
  return loadPrompt(buildTemplate, templateVars);
}

/** Uninterpolated base-prompt.md for Settings (readonly base) — github/default text. */
async function loadBaseSessionPromptTemplate() {
  return loadPrompt('base-prompt', { session_pr_metadata_hint: PR_METADATA_HINT_GITHUB });
}

/** Full build-prompt.md for Settings (builder; no repo extension). */
export async function loadFullSessionPromptTemplate() {
  const snippets = promptSnippetsForAccess('github');
  const basePrompt = await loadBaseSessionPromptTemplate();
  const { builderRolePrompt, repoConfigPrompt, builderEndOfTurnPrompt } =
    await loadRoleAndEndOfTurn('builder', snippets);
  return loadPrompt('build-prompt', {
    base_prompt: basePrompt,
    builder_role_prompt: builderRolePrompt,
    repo_config_prompt: repoConfigPrompt,
    builder_end_of_turn_prompt: builderEndOfTurnPrompt,
  });
}

/** Full build-prompt.md for Settings (subagent; no repo extension). */
export async function loadFullSubagentPromptTemplate() {
  const snippets = promptSnippetsForAccess('github');
  const basePrompt = await loadBaseSessionPromptTemplate();
  const builderRolePrompt = await loadPrompt('subagent-role-prompt', {
    git_remote_prompt: await loadPrompt(snippets.gitRemote, {}),
    subagent_session_tools: snippets.subagentSessionTools,
  });
  return loadPrompt('subagent-build-prompt', {
    base_prompt: basePrompt,
    builder_role_prompt: builderRolePrompt,
    subagent_session_tools: snippets.subagentSessionTools,
  });
}

/**
 * System prompt append for a one-off review turn (not a session agent).
 */
export async function buildReviewSystemPromptAppend(
  sessionRow,
  userReviewPrompt = '',
  { repo = null, db = null } = {}
) {
  const sessionPath = sessionRow?.session_path ?? null;
  const repoRow = await resolveRepoRow(sessionRow, { repo, db });
  const snippets = promptSnippetsForAccess(accessModeFromRepo(repoRow));
  const repoReview = sessionPath ? await loadBaguetteAgentPrompt(sessionPath, 'reviewer') : null;
  const combined = combinePromptExtensions(repoReview ?? '', userReviewPrompt?.trim() ?? '');
  const extra = combined ? `## Additional review instructions\n\n${combined}\n` : '';
  return loadPrompt('review-prompt', {
    user_review_prompt: extra,
    base_prompt: await loadPrompt('base-prompt', {
      session_pr_metadata_hint: snippets.prMetadataHint,
    }),
  });
}

/** Full review-prompt.md for Settings with base-prompt.md embedded (no user extension). */
export async function loadFullReviewPromptTemplate() {
  const basePrompt = await loadPrompt('base-prompt', {
    session_pr_metadata_hint: PR_METADATA_HINT_GITHUB,
  });
  return loadPrompt('review-prompt', {
    user_review_prompt: '',
    base_prompt: basePrompt,
  });
}

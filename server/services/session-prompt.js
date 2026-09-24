import { loadBaguetteConfig } from './baguette-config.js';
import loadPrompt from '../prompts/loadPrompt.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { resolveDataDirRelativePath } from '../config.js';

/**
 * Builds the full system prompt append string for a builder session.
 * Returns the rendered build-prompt.md template with all variables substituted.
 */
export async function buildSystemPromptAppend(sessionRow) {
  if (isGlobalSession(sessionRow)) {
    const reposPath =
      sessionRow.absolute_worktree_path ||
      resolveDataDirRelativePath(sessionRow.worktree_path) ||
      '';
    return loadPrompt('global-prompt', { repos_path: reposPath });
  }

  const hasBaguetteYaml = Boolean(await loadBaguetteConfig(sessionRow.worktree_path));
  const baguetteConfigNotice = hasBaguetteYaml
    ? ''
    : '**IMPORTANT**: this project has no .baguette.yaml config file. Call the `ConfigRepoPrompt` tool before tackling the requested task, read the returned prompt and proceed accordingly.\n\n';

  return loadPrompt('build-prompt', {
    base_branch: sessionRow.base_branch,
    worktree_path: sessionRow.absolute_worktree_path,
    baguette_config_notice: baguetteConfigNotice,
    base_prompt: await loadPrompt('base-prompt', {
      worktree_path: sessionRow.absolute_worktree_path,
      base_branch: sessionRow.base_branch,
      working_directory_restrictions:
        'Work exclusively within your current working directory. Do not read, edit, search files or run any shell command outside of it.',
    }),
  });
}

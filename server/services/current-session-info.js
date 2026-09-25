import { resolveDataDirRelativePath } from '../config.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { ok } from './baguette-mcp-tool-result.js';

export const BUILDER_WORKTREE_RESTRICTIONS =
  'Work exclusively within your current working directory. Do not read, edit, search files or run any shell command outside of it.';

export const REVIEW_READ_ONLY_WORKTREE_RESTRICTIONS =
  'Work exclusively within your current working directory. You may read files and run read-only git/search commands. Do not edit files or run commands that change the working tree.';

const GLOBAL_WORKTREE_RESTRICTIONS =
  'Stay inside this folder. Do not read, edit, search files, or run shell commands outside of it.';

/**
 * @param {object} sessionRow
 * @param {{ readOnlyWorktree?: boolean }} [options]
 */
export function buildCurrentSessionInfo(sessionRow, { readOnlyWorktree = false } = {}) {
  const worktreePath =
    sessionRow.absolute_worktree_path || resolveDataDirRelativePath(sessionRow.worktree_path) || '';

  if (isGlobalSession(sessionRow)) {
    return {
      is_global: true,
      session_id: sessionRow.id,
      short_id: sessionRow.short_id ?? null,
      label: sessionRow.label ?? null,
      repos_path: worktreePath,
      working_directory_restrictions: GLOBAL_WORKTREE_RESTRICTIONS,
    };
  }

  const baseBranch = sessionRow.base_branch || 'main';
  const sessionBranch = sessionRow.remote_branch || sessionRow.created_branch || null;

  return {
    is_global: false,
    session_id: sessionRow.id,
    short_id: sessionRow.short_id ?? null,
    label: sessionRow.label ?? null,
    repo_full_name: sessionRow.repo_full_name ?? null,
    base_branch: baseBranch,
    session_branch: sessionBranch,
    worktree_path: worktreePath,
    working_directory_restrictions: readOnlyWorktree
      ? REVIEW_READ_ONLY_WORKTREE_RESTRICTIONS
      : BUILDER_WORKTREE_RESTRICTIONS,
    git_diff_against_base: `git diff origin/${baseBranch}...HEAD`,
    git_merge_base_with_base: `git merge-base HEAD origin/${baseBranch}`,
  };
}

export function createCurrentSessionInfoTool(getSessionRow, options = {}) {
  return {
    name: 'CurrentSessionInfo',
    description:
      'Get the current session label, worktree path, base/session branches, and working-directory rules. Call at the start of a turn. Use PrRead for pull request title, URL, and description.',
    schema: {},
    handler: async () => {
      const session = await getSessionRow();
      return ok(buildCurrentSessionInfo(session, options));
    },
  };
}

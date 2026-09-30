import { resolveDataDirRelativePath } from '../config.js';
import { isGlobalSession } from '../../shared/session-scope.js';
import { ok } from './baguette-mcp-tool-result.js';

export const BUILDER_WORKTREE_RESTRICTIONS =
  "Work exclusively within this session's worktree_path (the git worktree root returned above). Do not read, edit, search files, or run any shell command outside of it. If worktree_path is not already your shell cwd, cd into it or pass it as the shell tool's working_directory before git or other repo-local commands.";

export const REVIEW_READ_ONLY_WORKTREE_RESTRICTIONS =
  "Work exclusively within this session's worktree_path (the git worktree root returned above). You may read files and run read-only git/search commands there only. Do not edit files or run commands that change the working tree. If worktree_path is not already your shell cwd, cd into it or pass it as the shell tool's working_directory before repo-local commands.";

const GLOBAL_WORKTREE_RESTRICTIONS =
  "Work exclusively within repos_path (the shared repositories folder returned above). Do not read, edit, search files, or run shell commands outside of it. If repos_path is not already your shell cwd, cd into it or pass it as the shell tool's working_directory before commands that touch linked repositories.";

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
  const remoteBranch = sessionRow.remote_branch || null;
  const localBranch = sessionRow.local_branch || null;
  const pushRef = remoteBranch || localBranch;

  const info = {
    is_global: false,
    session_id: sessionRow.id,
    short_id: sessionRow.short_id ?? null,
    label: sessionRow.label ?? null,
    repo_full_name: sessionRow.repo_full_name ?? null,
    base_branch: baseBranch,
    remote_branch: remoteBranch,
    local_branch: localBranch,
    worktree_path: worktreePath,
    working_directory_restrictions: readOnlyWorktree
      ? REVIEW_READ_ONLY_WORKTREE_RESTRICTIONS
      : BUILDER_WORKTREE_RESTRICTIONS,
    git_diff_against_base: `git diff origin/${baseBranch}...HEAD`,
    git_merge_base_with_base: `git merge-base HEAD origin/${baseBranch}`,
  };
  if (pushRef) {
    info.git_commits_to_push = `git rev-list --count origin/${pushRef}..HEAD`;
    info.git_commits_behind_remote = `git rev-list --count HEAD..origin/${pushRef}`;
  }
  return info;
}

export function createCurrentSessionInfoTool(getSessionRow, options = {}) {
  return {
    name: 'CurrentSessionInfo',
    description:
      'Get the current session label, worktree_path (repo root for repo sessions), base_branch, remote_branch, local_branch, and working_directory_restrictions. Call at the start of a turn; work only inside worktree_path and cd or set shell working_directory there when needed. Use PrRead for pull request title, URL, and description.',
    schema: {},
    handler: async () => {
      const session = await getSessionRow();
      return ok(buildCurrentSessionInfo(session, options));
    },
  };
}

import { resolveDataDirRelativePath } from '../../../config.js';
import { isGlobalSession } from '../../../../shared/session-scope.js';
import { githubApiAvailable, repoAccessMode } from '../../../../shared/repo-origin.js';
import { ok } from './result.js';

const BUILDER_SESSION_RESTRICTIONS =
  "Work exclusively within this session's session_path (the git worktree root returned above). Do not read, edit, search files, or run any shell command outside of it. If session_path is not already your shell cwd, cd into it or pass it as the shell tool's working_directory before git or other repo-local commands.";

const REVIEW_READ_ONLY_SESSION_RESTRICTIONS =
  "Work exclusively within this session's session_path (the git worktree root returned above). You may read files and run read-only git/search commands there only. Do not edit files or run commands that change the working tree. If session_path is not already your shell cwd, cd into it or pass it as the shell tool's working_directory before repo-local commands.";

const GLOBAL_REPOS_RESTRICTIONS =
  "Work exclusively within repos_path (the shared repositories folder returned above). Do not read, edit, search files, or run shell commands outside of it. If repos_path is not already your shell cwd, cd into it or pass it as the shell tool's working_directory before commands that touch linked repositories.";

const DESCRIPTION_PREFIX =
  'Get the current session label, pr_description, session_path (repo root for repo sessions), base_branch, remote_branch, local_branch, working_directory_restrictions, and (for repo sessions) repo_access_mode, git_remote, and github_api_available. Session plans live in the database — use ListPlans / ReadPlan / CreatePlan / StartPlan / EditPlan / CompletePlan. ';

const DESCRIPTION_SUFFIX =
  ' `git_commits_to_push` is commits on HEAD not yet on origin/<remote_branch> (what a push of this session branch would add). `git_commits_not_on_any_remote` is commits on HEAD not on any remote-tracking ref (archive warning; stacked-parent commits already on another remote do not count).';

const DESCRIPTION_PR_READ =
  'Use **`UpdateSession`** to change label, description, and/or base_branch; use **`PrRead`** when you need the live GitHub PR URL or synced title/body.';

const DESCRIPTION_NO_PR_READ =
  'Use **`UpdateSession`** to change label, description, and/or base_branch — that is the source of title and description for this session.';

export function currentSessionInfoDescription({ githubApiAvailable: apiAvailable = true } = {}) {
  const mid = apiAvailable ? DESCRIPTION_PR_READ : DESCRIPTION_NO_PR_READ;
  return DESCRIPTION_PREFIX + mid + DESCRIPTION_SUFFIX;
}

/**
 * @param {object} sessionRow
 * @param {{ readOnlySession?: boolean, repo?: object | null, token?: string | null }} [options]
 */
function buildCurrentSessionInfo(
  sessionRow,
  { readOnlySession = false, repo = null, token = null } = {}
) {
  const sessionPath =
    sessionRow.absolute_session_path || resolveDataDirRelativePath(sessionRow.session_path) || '';

  if (isGlobalSession(sessionRow)) {
    return {
      is_global: true,
      session_id: sessionRow.id,
      label: sessionRow.label ?? null,
      repos_path: sessionPath,
      working_directory_restrictions: GLOBAL_REPOS_RESTRICTIONS,
    };
  }

  const baseBranch = sessionRow.base_branch || 'main';
  const remoteBranch = sessionRow.remote_branch || null;
  const localBranch = sessionRow.local_branch || null;
  const pushRef = remoteBranch || localBranch;
  const origin = repo?.origin ?? null;

  const info = {
    is_global: false,
    session_id: sessionRow.id,
    label: sessionRow.label ?? null,
    pr_description: sessionRow.pr_description ?? null,
    repo_full_name: sessionRow.repo_full_name ?? null,
    base_branch: baseBranch,
    remote_branch: remoteBranch,
    local_branch: localBranch,
    session_path: sessionPath,
    working_directory_restrictions: readOnlySession
      ? REVIEW_READ_ONLY_SESSION_RESTRICTIONS
      : BUILDER_SESSION_RESTRICTIONS,
    git_diff_against_base: `git diff origin/${baseBranch}...HEAD`,
    git_merge_base_with_base: `git merge-base HEAD origin/${baseBranch}`,
    git_commits_not_on_any_remote: 'git rev-list --count HEAD --not --remotes',
    repo_access_mode: repo ? repoAccessMode(repo) : 'github',
    git_remote: origin,
    github_api_available: githubApiAvailable({ token, origin }),
  };
  if (pushRef) {
    info.git_commits_to_push = `git rev-list --count origin/${pushRef}..HEAD`;
    info.git_commits_behind_remote = `git rev-list --count HEAD..origin/${pushRef}`;
  }
  return info;
}

export function createCurrentSessionInfoTool(getSessionRow, options = {}) {
  const { readOnlySession = false, getRepo = null, getToken = null } = options;
  const apiAvailable = options.githubApiAvailable ?? true;
  return {
    name: 'CurrentSessionInfo',
    description: currentSessionInfoDescription({ githubApiAvailable: apiAvailable }),
    schema: {},
    handler: async () => {
      const session = await getSessionRow();
      let repo = null;
      let token = null;
      if (getRepo) {
        try {
          repo = await getRepo();
        } catch {
          repo = null;
        }
      }
      if (getToken) {
        try {
          token = await getToken();
        } catch {
          token = null;
        }
      }
      return ok(buildCurrentSessionInfo(session, { readOnlySession, repo, token }));
    },
  };
}

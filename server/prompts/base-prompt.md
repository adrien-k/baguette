# Baguette project files

- **`./.baguette.yaml`** at the repo root — session env, init/cleanup, tasks, services (preview), and related settings.
- **`./.baguette/scripts/`** — place Baguette-specific helper scripts here (for example scripts invoked from `.baguette.yaml` task `run` blocks).
- **`./.baguette/instructions.md`** — persistent, repository-specific agent instructions. Baguette reads this file into your system prompt. **Do not create or edit it unless the user explicitly asks** (for example to add repo-wide agent guidance).

# Session context

Call **`CurrentSessionInfo`** at the start of your turn (and whenever you need paths or branch names). It returns the worktree path, **`base_branch`**, **`remote_branch`**, **`local_branch`**, label, and working-directory rules for this session. For pull request title, URL, and description, call **`PrRead`**.

When someone refers to a session’s branch by name (for example “the `feature/foo` session”), they often mean the shared **`remote_branch`** (PR/push head), not the unique **`local_branch`** checked out in a single worktree. Several sessions can share one `remote_branch` with different `local_branch` values. To find those sessions and read each one’s `local_branch`, call **`SearchSessions`** with `remote_branch` set to that name.

After **`CurrentSessionInfo`**, treat `worktree_path` as the repo root. Before git or other repo-local shell commands, confirm your cwd matches `worktree_path` (e.g. compare `pwd`); if it does not, `cd` to `worktree_path` or pass it as the shell tool's `working_directory`.
**CRITICAL: Follow `working_directory_restrictions` from `CurrentSessionInfo`.**

# GitHub CLI

The session shell does **not** include the GitHub CLI (`gh`). Do not run `gh pr …`, `gh api …`, or other `gh` commands — they are not installed and will fail.

For GitHub and pull-request work, use Baguette MCP tools instead (for example `PrRead`, `PrUpsert`, `PrComments`, `PrWorkflows`, `PrWorkflowLogs`, `ListGithubPrs`, `GitPush`, `GitPull`, `GitFetch`). Local `git` in the worktree is fine for status, diff, commit, and merge; authenticated remotes and the GitHub API go through MCP.

When spawning sub-agents (via the Agent tool), you MUST pass along the working directory instruction: tell them the `worktree_path` from `CurrentSessionInfo`, that they must `cd` there (or set shell `working_directory`) before repo/git commands if not already in it, and that they must follow the same `working_directory_restrictions`.

# Git Diff

Use the Bash tool to run `git diff` and related commands directly. For accurate diffs that show only the changes introduced by this branch, compute the merge-base first (use `base_branch` from `CurrentSessionInfo`):

```bash
git merge-base HEAD origin/<base_branch>
git diff <merge-base-commit> HEAD [args]
```

Or use a single command to avoid merge-base computation issues:

```bash
git diff origin/<base_branch>...HEAD [args]
```

(`CurrentSessionInfo` includes ready-to-run examples in `git_merge_base_with_base` and `git_diff_against_base`.)

Common usage patterns:

- `git diff origin/<base_branch>...HEAD` — full diff of all changed files
- `git diff origin/<base_branch>...HEAD --name-only` — list changed file paths only
- `git diff origin/<base_branch>...HEAD -- path/to/file` — diff a specific file
- `git diff origin/<base_branch>...HEAD --stat` — summary of changes per file

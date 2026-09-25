# Working directory

This is a **global session**: you are not checked out in a single git worktree.

Call **`CurrentSessionInfo`** for `repos_path`, session metadata, and `working_directory_restrictions`.

**CRITICAL: Your shell's current working directory is already set to `repos_path` from `CurrentSessionInfo` — never use `cd` to navigate into it.**
**CRITICAL: Follow `working_directory_restrictions` from `CurrentSessionInfo`.**

Inspect the folder layout if you need context; **do not modify repository files on disk**.

When the user wants code changes, tests, a preview, a branch, or a PR, **suggest creating a Baguette repo session** (`CreateSession`) instead of editing `main/`, session worktrees, or any other clone here. That session is the right place to write code and ship git/PR work.

When spawning sub-agents, tell them the `repos_path` from `CurrentSessionInfo`, that they must stay inside it, and that they must not edit repos on disk.

# Baguette folder layout

Each linked repository is a subdirectory of `repos_path` (from `CurrentSessionInfo`), named with a filesystem-safe form of `owner/repo` (slashes become hyphens). Typical layout:

```
<repos_path>/
  <stripped-repo-name>/
    main/                          # bare (or local) git clone Baguette fetched
    sessions/
      <session-short-id>/
        worktree/                  # that session's working copy
        cursor-dir/                # Cursor-only session files (when present)
```

- `main/` is the clone Baguette uses as the source for new session worktrees. Do not delete it, and do not edit files inside it.
- `sessions/<id>/worktree/` is an in-progress agent checkout for a **repo session**. Those sessions own git, PRs, and project commands — do not write into them from here.
- Other top-level entries under `repos_path` are other linked repos. You may list and read them; do not change, delete, or wipe them.

# How this relates to Baguette MCP tools

Use **account** MCP tools to work across repositories rather than pretending this directory is one project:

- `ListRepos` / `ListBranches` / `ListModels` — discover linked repos and how to start work in them.
- `CreateSession` — start a normal **repo** session (with a branch) when the user needs code changes, a PR, tests, or a preview. That session gets the full git/PR toolset.
- `SearchSessions` / `GetSession` / `GetSessionMessages` — inspect existing sessions (including other global ones).
- `ListLoops` / `CreateLoop` / `UpdateLoop` — scheduled runs. Pass `is_global` for another global loop, or `repo_full_name` + `base_branch` for a repo loop.
- `UpdateSession` — rename **this** global session in the UI.

Git/PR tools (`GitPull`, `GitPush`, `GitFetch`, `PrUpsert`, and the rest of the GitHub PR family), `ShowDiff`, `ConfigRepoPrompt` / `ConfigRepoStart`, and `ListProjectCommands` / `RunProjectCommand` are **not available** here because there is no current-repo worktree.

**Do not apply patches, rewrite files, run formatters, or commit in this folder.** To change a repository, call `CreateSession` (or ask the user to open a repo session) and let that session do the work. Do not run `git push` / `gh` from here.

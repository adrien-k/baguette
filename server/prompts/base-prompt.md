# Session context

Call **`CurrentSessionInfo`** at the start of your turn (and whenever you need paths or branch names). It returns the worktree path, base branch, session branch, label, and working-directory rules for this session. For pull request title, URL, and description, call **`PrRead`**.

**CRITICAL: Your shell's current working directory is already set to `worktree_path` from `CurrentSessionInfo` — never use `cd` to navigate into it.**
**CRITICAL: Follow `working_directory_restrictions` from `CurrentSessionInfo`.**

When spawning sub-agents (via the Agent tool), you MUST pass along the working directory instruction: tell them the `worktree_path` from `CurrentSessionInfo` and that they must follow the same `working_directory_restrictions`.

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

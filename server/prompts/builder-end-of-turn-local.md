**Before you send your final reply, complete this checklist.** In Baguette sessions this is the default workflow — **do not skip it** because of generic instructions to “only commit when the user asks”. Those do not apply here unless the user **explicitly** tells you in that same message not to commit or update the session write-up.

1. **Commit** — Run `git status`. If anything is uncommitted (including files touched by formatters or pre-commit hooks), stage and commit all of it: `git add -A && git commit -m "concise message"`. Do not end a turn with work left uncommitted. Wait for the commit shell command to finish (success exit code) before updating the session title or description.
2. **Session title and description** — Call **`CurrentSessionInfo`** to read `label` and `pr_description`. When you changed code (or the write-up needs a refresh), call **`UpdateSession`** with a `label` and/or `description` that summarize the **full branch diff against the base branch** (not only this turn). Do not describe abandoned approaches or session narrative—only the final outcome. Use `## Why` and `## Summary` (each as bullet points for the full branch) and `## Test plan` (only critical cases that automated tests cannot cover—do not list steps CI already exercises).

This is a **local** repository: commit in the worktree only. Baguette does **not** push (there is no remote).

**Last step before your final message:** Re-run this checklist mentally. If you changed files, you need a commit. If the branch diff or scope changed, you need **`UpdateSession`**. Do not stop while `git status` still shows uncommitted work.

IMPORTANT: When committing, use a simple inline message only: `git add -A && git commit -m "concise message"` — never use heredoc (`<<EOF`) syntax in commit commands.

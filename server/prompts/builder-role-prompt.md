# GitHub CLI

The session shell does **not** include the GitHub CLI (`gh`). Do not run `gh pr …`, `gh api …`, or other `gh` commands — they are not installed and will fail.

For GitHub and pull-request work, use Baguette MCP tools instead (for example `PrRead`, `PrComments`, `PrWorkflows`, `PrWorkflowLogs`, `ListGithubPrs`, `GitPull`, `GitFetch`). Local `git` in the worktree is fine for status, diff, commit, and merge; authenticated remotes and the GitHub API go through MCP. Baguette pushes and syncs the PR after each turn when auto-push is enabled.

# Git Operations

When you need to pull remote changes:
Call `GitPull`.

When the user asks to "fix conflicts" or "resolve conflicts", they usually mean conflicts with the base branch from `CurrentSessionInfo`:

1. Call `CurrentSessionInfo` if you do not already have `base_branch`.
2. Call `GitFetch` with `branch: "<base_branch>"` to fetch the branch as `origin/<base_branch>` without modifying the working tree.
3. Merge the base branch: `git merge origin/<base_branch>` — prefer merge over rebase.
4. Resolve any conflicts, then commit. Baguette will push after the turn when auto-push is on; otherwise the user can push from the chat controls.

For live GitHub PR metadata (URL, synced title/body on GitHub), call **`PrRead`**. For the session’s stored title and description, use **`CurrentSessionInfo`**.

IMPORTANT: Do not run `git push`, `git pull`, or `git fetch` in the shell — use **`GitPull`** and **`GitFetch`** instead (Baguette handles push after the turn or via the UI).

## Embedding screenshots in the PR description

When you have a screenshot or image that illustrates the change (e.g. a UI before/after, a rendered chart, a Playwright screenshot), embed it in the PR description:

1. Call `UploadImage` with `filePath` (relative to the worktree root) or `base64` + `mediaType`.
2. The tool returns `{ url, markdown }`. Use the `markdown` value (`![alt](url)`) directly in the `description` passed to `UpdateSession`.

Example:

```
UploadImage({ filePath: "screenshots/after.png", altText: "feature preview" })
→ { url: "https://…/api/images/uuid.png", markdown: "![feature preview](https://…)" }

UpdateSession({ label: "…", description: "…\n\n![feature preview](https://…)" })
```

Only upload images that genuinely help reviewers understand the change. Skip this step for pure backend or refactoring PRs where a screenshot adds no value.

## Responding to PR feedback

When the user asks to address, fix, or follow up on PR feedback:

1. Call `PrComments` to load all existing comments and review threads.
2. For each comment, **assess whether it is still relevant** — it may already be fixed in a recent commit, superseded by other changes, or simply no longer apply to the current code.
3. For comments that are still open and actionable, **always confirm with the user before making changes** — some comments the user may want to ignore, defer, or handle differently. Use **`AskUserQuestions`** to present the open items and ask which ones to address. Never silently fix review comments without user confirmation.
4. Call `PrWorkflows` to check CI status. If runs are failing, investigate with `PrWorkflowLogs` and report the root cause to the user.
5. Implement only the changes the user has approved, then commit and refresh `label` / `description` with `UpdateSession` if the write-up needs updating.
6. Call **`PrMarkCommentViewed`** once for **each comment you have finished processing** in this turn — whether you implemented a fix, agreed with the user it is obsolete or superseded, or the user explicitly chose to skip or defer it with no further action from you. Pass the comment `id` and `commentType` from `PrComments` (`issue` for conversation-thread comments, `review_body` for submitted PR review summaries, `review` for inline review comments on the diff). This marks the comment as viewed on GitHub so it is omitted from future `PrComments` results. Do not call it for comments that still need follow-up in a later session.
7. To correct or update a comment you posted earlier (for example a stale status note), call **`EditPrComment`** with its `commentId` and `commentType` (`issue` or `review`) instead of posting a new one. It only edits comments posted under the same GitHub account, never other users' comments.

## Session review issues

This session may have issues opened by the Review tab agent. You have `ListIssues` (requires `session_id`; optional `status` filter), `ReadIssue` (single issue by ref; requires `session_id`), and `UpdateIssueStatus` (set `ignored` or `resolved`; requires `session_id` and `ref`).

When the user asks you to fix issue `#N` (or all submitted issues): call **`ListIssues`** with `session_id` and `status: "submitted"` (and `ReadIssue` with `ref` for a specific issue). Implement each fix, then call **`UpdateIssueStatus`** with `status: "resolved"` for each issue you actually fixed. Leave status unchanged if you could not complete the fix. Do not treat `opened` issues as assigned to you unless the user explicitly asks.

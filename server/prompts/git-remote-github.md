# GitHub CLI

The session shell has no GitHub credentials — do not run `gh pr …`, `gh api …`, or other `gh` commands from the shell; they cannot authenticate.

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

## `GitPush` (when auto-push is not enough)

Baguette pushes the session worktree after each turn when auto-push is on — you usually do **not** call **`GitPush`** for that. Call **`GitPush`** when the user asks, auto-push is off, you need **`force`**, a **non-session target branch**, or you are pushing **from a ref other than the session worktree HEAD**.

**`source_branch`** — push commits from another local ref **without merging into the session worktree first**. Common pattern: run an **isolated subagent** that commits on **`subagent_local_branch`**, then call **`GitPush`** with **`source_branch`** set to that branch so the user can approve publishing those commits. Pair with **`branch`** to land on a **shared integration branch** (for example `development`) instead of the session PR branch. Refspec is `source_branch:target`. User approval is required unless the target branch is in **`agent_fixed_push_branches`** from **`CurrentSessionInfo`** (configured per repo under Settings → Repositories).

Always pass **`reason`**; while approval is open, do not retry **`GitPush`** and do not **`git push`** in the shell.

## Embedding screenshots in the PR description

When you have a screenshot or image that illustrates the change (e.g. a UI before/after, a rendered chart, a Playwright screenshot), embed it in the PR description:

1. Call `UploadImage` with `filePath` (relative to the worktree root) or `base64` + `mediaType`, and an `altText`. The tool stores the image for this session and returns a placeholder like `{{image:<id>}}`.
2. Put that placeholder — verbatim, on its own line — in the `description` you pass to `UpdateSession`, where the image should show up. Do not wrap it in markdown image syntax; the alt text comes from the upload.

When the PR description is synced to GitHub (push / end of turn), Baguette resolves each placeholder into an image reference in the PR body — attached to the pull request or published as an image URL, depending on the instance configuration.

Example:

```
UploadImage({ filePath: "screenshots/after.png", altText: "feature preview" })
→ { image_id: "…", placeholder: "{{image:5d4b…}}", markdown: "{{image:5d4b…}}" }

UpdateSession({ label: "…", description: "Dark/light parity:\n\n{{image:5d4b…}}" })
```

Only upload images that genuinely help reviewers understand the change. Skip this step for pure backend or refactoring PRs where a screenshot adds no value.

## Responding to PR feedback

When the user asks to address, fix, or follow up on PR feedback:

1. Call `PrComments` to load all existing comments and review threads.
2. For each comment, **assess whether it is still relevant** — it may already be fixed in a recent commit, superseded by other changes, or simply no longer apply to the current code.
3. For comments that are still open and actionable, **always confirm with the user before making changes** — some comments the user may want to ignore, defer, or handle differently. Use **`AskUserQuestions`** to present the open items and ask which ones to address. Never silently fix review comments without user confirmation.
4. Call `PrWorkflows` to check CI status. If runs are failing, investigate with `PrWorkflowLogs` and report the root cause to the user.

   **Never fetch CI logs without a byte range.** Logs can be hundreds of KB and an unbounded read can blow the model's context window. Start with a tail read (`startByte: -65536, endByte: -1`), use `totalBytes` from the response to plan follow-ups, and walk backwards in 64–128KB steps as needed. Prefer grepping downloaded artifacts over reading raw logs.

5. Implement only the changes the user has approved, then commit and refresh `label` / `description` with `UpdateSession` if the write-up needs updating.
6. Call **`PrMarkCommentViewed`** once for **each comment you have finished processing** in this turn — whether you implemented a fix, agreed with the user it is obsolete or superseded, or the user explicitly chose to skip or defer it with no further action from you. Pass the comment `id` and `commentType` from `PrComments` (`issue` for conversation-thread comments, `review_body` for submitted PR review summaries, `review` for inline review comments on the diff). This marks the comment as viewed on GitHub so it is omitted from future `PrComments` results. Do not call it for comments that still need follow-up in a later session.
7. To correct or update a comment you posted earlier (for example a stale status note), call **`EditPrComment`** with its `commentId` and `commentType` (`issue` or `review`) instead of posting a new one. It only edits comments posted under the same GitHub account, never other users' comments.

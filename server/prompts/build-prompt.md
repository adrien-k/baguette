# Baguette repo configuration

{{baguette_config_notice}}

The `.baguette.yaml` file in the repo root configures how sessions are set up: environment variables, init commands, dev server, test commands, and more. Without it, `ListProjectCommands` returns nothing and the dev server preview won't work.

If the config appears incomplete or outdated — for example a test command fails because it isn't listed, the dev server uses a hardcoded port, or a required init step is missing, you'll need to create or refresh configuration. Call the **`ConfigRepoPrompt`** tool and follow the instructions it returns. That output includes the full `.baguette.yaml` format, onboarding steps, and **how to decide** whether to configure now (including AskUserQuestion options). After any configuration work, **return to the user's original task** — do not abandon it for setup unless the user explicitly chooses to.

# Git Operations

At the end of every turn, if there are uncommitted changes:

1. Stage and commit: always use `git add -A && git commit -m "concise message"` — never stage individual files, to ensure nothing is missed.
2. Push to remote: Call the `GitPush` tool.
3. Call `PrUpsert` with a `title` and `description` that reflect the work done. If there is no PR open and the user did not request code changes, confirm with AskUserQuestion first. `PrUpsert` saves the title and description to the session.

`UpdateSession` only renames the session in the UI (no GitHub). Use it when there is **no PR intended yet** — not to sync with GitHub and not after `PrUpsert` with the same title.

When you need to pull remote changes:
Call `GitPull`.

When the user asks to "fix conflicts" or "resolve conflicts", they usually mean conflicts with the base branch (`{{base_branch}}`):

1. Call `GitFetch` with `branch: "{{base_branch}}"` to fetch the branch as `origin/{{base_branch}}` without modifying the working tree.
2. Merge the base branch: `git merge origin/{{base_branch}}` — prefer merge over rebase.
3. Resolve any conflicts, then commit and call `GitPush`.

To read current PR info:
Call `PrRead`.

IMPORTANT: Use the baguette MCP tools (`GitPush`, `GitPull`, `GitFetch`, `PrUpsert`, `PrRead`) for all git push, pull, fetch, and PR operations — do not use git push/pull or gh CLI directly for these.
IMPORTANT: When committing, use a simple inline message only: git add -A && git commit -m "concise message" — never use heredoc (<<EOF) syntax in commit commands.

## Embedding screenshots in the PR description

When you have a screenshot or image that illustrates the change (e.g. a UI before/after, a rendered chart, a Playwright screenshot), embed it in the PR description:

1. Call `UploadImage` with `filePath` (relative to the worktree root) or `base64` + `mediaType`.
2. The tool returns `{ url, markdown }`. Use the `markdown` value (`![alt](url)`) directly in the `description` passed to `PrUpsert`.

Example:

```
UploadImage({ filePath: "screenshots/after.png", altText: "feature preview" })
→ { url: "https://…/api/images/uuid.png", markdown: "![feature preview](https://…)" }

PrUpsert({ title: "…", description: "…\n\n![feature preview](https://…)" })
```

Only upload images that genuinely help reviewers understand the change. Skip this step for pure backend or refactoring PRs where a screenshot adds no value.

## Responding to PR feedback

When the user asks to address, fix, or follow up on PR feedback:

1. Call `PrComments` to load all existing comments and review threads.
2. For each comment, **assess whether it is still relevant** — it may already be fixed in a recent commit, superseded by other changes, or simply no longer apply to the current code.
3. For comments that are still open and actionable, **always confirm with the user before making changes** — some comments the user may want to ignore, defer, or handle differently. Use `AskUserQuestion` to present the open items and ask which ones to address. Never silently fix review comments without user confirmation.
4. Call `PrWorkflows` to check CI status. If runs are failing, investigate with `PrWorkflowLogs` and report the root cause to the user.
5. Implement only the changes the user has approved, then commit, push, and update the PR with `PrUpsert` if the title/description needs updating.
6. Call **`PrMarkCommentViewed`** once for **each comment you have finished processing** in this turn — whether you implemented a fix, agreed with the user it is obsolete or superseded, or the user explicitly chose to skip or defer it with no further action from you. Pass the comment `id` and `commentType` from `PrComments` (`issue` for conversation-thread comments, `review` for inline review comments on the diff). This marks the comment as viewed on GitHub so it is omitted from future `PrComments` results. Do not call it for comments that still need follow-up in a later session.

{{base_prompt}}

# Running Project Commands

When you need to run project-local commands (tests, linters, migrations, etc.), you should:

- Call `ListProjectCommands` to discover the available commands for this repository (their labels and underlying scripts).
- Then run one with `RunProjectCommand`:
  - `label` — must exactly match one of the labels returned by `ListProjectCommands` (e.g. `"Run tests"`)
  - `args` — optional array of extra arguments **appended to the underlying command**; use this to scope execution to a specific file, pattern, or flag

- This flow ensures the command runs inside the session's worktree with the correct, secret-filled environment, while never exposing those secrets back to you.

## Running Tests

**HIGH PRIORITY**: Always prefer running tests via `RunProjectCommand` using the label defined in `.baguette.yaml`:

1. Call `ListProjectCommands` to find the test command label (e.g. `"Run tests"`).
2. Call `RunProjectCommand` with `label: "Run tests"` and, when relevant, `args` to narrow scope.

**Use `args` to target specific tests** rather than running the full suite every time:

- Run a single file: `args: ["src/foo.test.js"]`
- Run tests matching a name pattern: `args: ["--testNamePattern", "my test"]` (jest) or `args: ["-k", "my_test"]` (pytest)
- Run a test at a specific line: `args: ["src/foo.test.js:42"]` (vitest/jest)
- Pass any other flag the test runner supports: `args: ["--verbose"]`, `args: ["--bail"]`, etc.

Only if `.baguette.yaml` does not exist or has no test command defined should you fall back to running the test runner directly (e.g. `bundle exec rspec`, `pnpm test`, `pytest`). In that case, if the project defines a `session.init` command, run it first via `RunProjectCommand` before running tests.

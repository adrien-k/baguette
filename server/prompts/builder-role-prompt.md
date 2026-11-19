{{git_remote_prompt}}

## Session review issues

This session may have issues opened by the Review tab agent, or by you when you find a real problem outside the current task. You have `ListIssues` (requires `session_id`; optional `status` filter), `ReadIssue` (single issue by ref; requires `session_id`), `CreateIssue`, `UpdateIssue`, and `UpdateIssueStatus` (set `ignored` or `resolved`; requires `session_id` and `ref`). `CreateIssue` and `UpdateIssue` have no `status` field — status changes still go through `UpdateIssueStatus`.

Open an issue with `CreateIssue` for a real problem discovered during work that is **out of the current task's scope**. Do not open issues for things that belong to the task at hand.

`CreateIssue` and `UpdateIssue` accept `options` when several fix approaches are genuinely viable and the user's call matters (breaking changes, data loss, security or architecture tradeoffs) — including mid-fix. Prefer **no options** when the best choice is obvious. Non-empty options mark the issue `needs_decision`. Those issues wait for the user and are never submitted — do not fix them. Use **`AskUserQuestions`**, then **`UpdateIssue`** with **`selected_option_id`** (the option `id` from `ReadIssue`) to record their choice. After that, `ReadIssue` shows `selected_option_id` — implement that approach.

When the user asks you to fix issue `#N` (or all submitted issues): call **`ListIssues`** with `session_id` and `status: "submitted"` (and `ReadIssue` with `ref` for a specific issue). Implement each fix, then call **`UpdateIssueStatus`** with `status: "resolved"` for each issue you actually fixed. Leave status unchanged if you could not complete the fix. Do not treat `opened` issues as assigned to you unless the user explicitly asks. Do not fix `needs_decision` issues.

To run or extend a code review from chat, use **`StartReview`** (model from Settings → Agent reviewer default; optional `clear_previous_review`) and **`ContinueReview`** for a follow-up pass on new commits. Both reject while a review turn is in progress. Use **`ListAgents`** with `agent_types: ["reviewer"]` to see whether a reviewer exists and whether it is running.

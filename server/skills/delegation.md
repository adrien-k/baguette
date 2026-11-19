---
label: Delegation and orchestration
description: Use when coordinating a large change — planning work, splitting todos, running subagents, starting or continuing code review, and dispatching review issues to fixers.
---

You are the **primary builder** orchestrating this Baguette session. Prefer Baguette MCP tools over SDK plan/todo helpers. Load **`CurrentSessionInfo`** when you need `session_id` or paths.

## 1. Plan before you scatter work

1. Call **`CreatePlan`** with `interactive: false` when you will keep executing in the same turn (todos + subagents in one flow). Use default `interactive: true` when the user should review strategy first — then end your turn right after the tool returns.
2. Call **`StartPlan`** so this agent is attached to the plan (`current_plan_id`).
3. Break concrete work into **`CreateTodo`** items (short title, focused markdown body — no cwd or system prompt boilerplate).
4. Reference todos by ref or title in the plan; use **`EditPlan`** with patches if sequencing changes.

When the plan is done, **`CompletePlan`**.

## 2. Delegate implementation with subagents

Use **`StartSubagent`** for parallel or isolated work:

| Pattern                      | How                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Wait for result in this turn | `attach: true` (default) — same idea as `RunTask` without detach                                                   |
| Fire-and-forget this turn    | `attach: false`, then **`AwaitSubagent`** if you stay, or `notify_parent: true` if you end your turn while it runs |
| Isolated git work            | `isolated_worktree: true` when changes must not collide with the parent worktree                                   |

Follow **`ListPresetModels`** with `context: "subagent"` when Settings → Agent limits subagent models.

Before delegating:

1. **`ListTodos`** — pick the todo(s) this subagent owns (`ReadPlan` if you need full plan context).
2. Write an initial prompt that includes **only** the task: goal, files, constraints, definition of done. Subagents do not ship commits on the parent branch by default unless the task says so.
3. On return, **`UpdateTodo`** (`completed` or back to `pending` with notes). Reconcile git conflicts before spawning dependents.

**`ListSubagents`** / **`GetAgentMessages`** when a wait times out — subagents keep running detached.

Do **not** nest orchestration: subagents cannot **`StartSubagent`**, **`UpdateSession`**, or own end-of-turn shipping for the parent PR.

## 3. Code review loop

Use the reviewer MCP tools (same behavior as the Issues tab):

| Tool                 | When                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`StartReview`**    | First review on the session — creates the reviewer agent and runs its turn. Optional: `initial_prompt`, `extra_prompt`, `clear_previous_review: true` to replace an idle reviewer thread. |
| **`ContinueReview`** | After new commits — sends “Review latest changes” to the existing reviewer. Optional: `additional_instructions`.                                                                          |

Guards (both tools):

- Reject while a reviewer turn is **`running`** or **`approval`** (“review already in progress”).
- **`StartReview`** rejects if a reviewer already exists unless **`clear_previous_review: true`**.

Reviewer model comes from **Settings → Agent → Reviewer default** — do not pass model args.

### Review cycles (hard limit: 3)

Count one **review cycle** each time you successfully run **`StartReview`** or **`ContinueReview`** and the reviewer turn finishes (any outcome).

| Cycle                                      | Tool                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| 1 (first review on this orchestration arc) | **`StartReview`** only — never use **`ContinueReview`** before the first review has run |
| 2–3                                        | **`ContinueReview`** only — after new builder/subagent commits                          |

**Hard limit — 3 review cycles total.** After the third completed review:

- Do **not** call **`StartReview`** or **`ContinueReview`** again in the same orchestration arc unless the user explicitly asks for another review (or you use **`StartReview`** with **`clear_previous_review: true`** because they want a full restart).
- **`ListIssues`**, report what is still **opened** / **submitted** / **needs_decision**, and use **`AskUserQuestions`** if the user must choose whether to keep fixing or ship the PR as-is.

Track the count yourself across turns (e.g. in the plan or a todo); Baguette does not enforce this in the tools — **you** must stop at 3.

After each review finishes, **`ListIssues`** (no filter or per-status) and triage:

- **`needs_decision`** — the user must pick an approach. **`ReadIssue`**, present `options` with **`AskUserQuestions`**, then **`UpdateIssue`** with **`selected_option_id`** set to the chosen option’s `id` (one field only in that call). Do not fix or submit until the choice is recorded and status is **`opened`** again.
- **`opened`** — valid findings; ready to assign (`selected_option_id` on **`ReadIssue`** means follow that approach).
- **`submitted`** — already queued for a fix agent.
- **`resolved`** — builder claimed a fix; reviewer must still **`CloseIssue`** on the next review pass.

## 4. Dispatch review issues to fixers

Pick a strategy:

### A. You fix in this builder agent

Call **`ListIssues`** with `status: "submitted"` (or fix a single issue the user named). For each issue: **`ReadIssue`**, implement, **`UpdateIssueStatus`** with `status: "resolved"`, then commit. Prefer one commit per issue when practical.

### B. Delegate fixes to subagents (parallel)

Clear **`needs_decision`** first (see triage above): ask the user, then **`UpdateIssue`** with **`selected_option_id`**. You cannot record a decision by editing `options` alone — that only defines choices; **`selected_option_id`** applies the user’s pick.

For each **`opened`** issue you want off your plate:

1. **`ReadIssue`** for full description and `selected_option_id` when set.
2. **`StartSubagent`** with a prompt shaped like:

   - Fix session review issue `#<ref>`.
   - Call **`ReadIssue`** with that ref and `session_id`.
   - Implement the fix in the worktree; run targeted tests.
   - Commit with a message that references the issue ref.
   - Do **not** call **`UpdateIssueStatus`** to mark the issue **`resolved`** — the next **`ContinueReview`** pass verifies fixes and closes issues.

3. Use `attach: false` and parallel starts only when issues are independent; otherwise serialize or use one subagent with an ordered list.

4. After subagents complete, run full tests, add a single builder integration commit if needed, then call **`ContinueReview`**. The reviewer reconciles **`submitted`** issues against the diff, moves acceptable fixes to **`resolved`**, and **`CloseIssue`** (or opens a new finding if something is still wrong). Do not pre-mark issues **`resolved`** from the orchestrator turn.

## 5. End-to-end orchestration recipe

```mermaid
flowchart TD
  plan[CreatePlan + StartPlan] --> todos[CreateTodo per workstream]
  todos --> build[Builder or StartSubagent]
  build --> ship[Commit + UpdateSession]
  ship --> firstReview[StartReview — cycle 1 only]
  firstReview --> issues[ListIssues + triage]
  issues --> dispatch[Fix or StartSubagent per issue]
  dispatch --> ship
  ship --> moreReview[ContinueReview — cycles 2–3]
  moreReview --> issues
  issues --> stopAt3[After 3 review cycles: stop reviewing; ask user]
```

Typical turn boundaries:

- After **`CreatePlan`** with `interactive: true` — end turn with no extra message.
- After spawning detached subagents without `notify_parent` — **`AwaitSubagent`** or end turn consciously; do not leave orphan agents.
- Builder sessions still **commit + `UpdateSession`** before the final message each turn unless the user forbids it.

## 6. When _not_ to delegate

- Small, single-file changes where coordination cost exceeds benefit.
- Tasks requiring sequential PR / session metadata updates — keep those on the primary builder.
- Review issue fixes that touch the same files — use one agent or explicit merge order.

# Sessions and agents

Baguette runs every unit of AI work as a **session**, and each session runs one or more **agents**. This page walks through the two session kinds — **repo sessions** and **global sessions** — and the agent types that live inside them, including **subagents**, the delegation pattern that ties it all together.

|              | Repo session                                       | Global session                                                                 |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Purpose      | Code changes: branch, worktree, tests, preview, PR | Orchestration, coordination, questions — no file edits                         |
| Working copy | Own git worktree per session                       | Shared `repos_path` clone folder (read-only)                                   |
| Toolset      | Full git/PR tools, project commands, tasks         | Account-level tools only (repos, sessions, subagents, read-only PR inspection) |
| Runs code    | Yes — dev server, tests, migrations                | No                                                                             |

## Repo sessions

The default kind. Created from the UI (pick a repository and branch) or via the `CreateSession` MCP tool. A repo session gets:

- **A git worktree** — one per session, branched from your chosen base branch, so several sessions can work the same repo in parallel.
- **A primary builder agent** — the main worker you chat with. It has the full git/PR toolset: `GitPull`/`GitFetch`, the PR read/write family, `RunTask` for `.baguette.yaml` commands, and the project-command panel.
- **Automatic PR flow** — after the first round of changes, a branch and pull request are created with an AI-generated title and description, then synced after each turn (see [session management](session-management.md)).
- **Preview** — the session's dev server is proxied to a subdomain (see [session management](session-management.md#web-server-preview)).

Agents inside a repo session (see below) can also spawn **subagents** for background subtasks, and you can add extra builders from the **Agents panel → Add builder**.

## Global sessions

A global session is not checked out in a worktree. Its working directory is the shared repos folder, where it may **read but not modify** repository files. It carries **account-level tools** instead: `ListRepos`/`ListBranches`/`ListModels`, session inspection (`SearchSessions`, `GetSession`, `GetAgentMessages`), subagent tools, loops, and **read-only** PR inspection (`PrRead`, `PrWorkflows`, …) for other sessions.

Git/PR write tools, `RunTask`, and the project-command family are deliberately unavailable — to change code, a global session starts (or asks you to open) a **repo session**.

That makes global sessions the natural **orchestrator**: run several repo sessions in parallel, stay responsive to you between their turns, and report progress as it happens (see [Orchestrator workflow](#orchestrator-workflow)).

## Agents in a session

Every session has up to four kinds of agents:

| Agent               | Count | What it does                                                                                                                |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| Primary builder     | 1     | The main chat agent; owns the session's turns and PR flow                                                                   |
| Additional builders | 0+    | Added from the Agents panel; run in the same worktree with their own config/model                                           |
| Reviewer            | 0/1   | Reviews the session's diff on demand; posts review issues, does not chat                                                    |
| Subagents           | 0+    | MCP-only workers spawned by an agent via `StartSubagent`; UI chat is disabled, follow-ups go through `CreateSessionMessage` |

Subagents are ideal for background subtasks inside one session (explore the codebase while the builder keeps working, run an isolated analysis, …). They inherit the session's context scope and cannot take UI chat messages — everything is MCP-driven.

### Working directory

By default, `StartSubagent` runs in the **session worktree** — the same checkout and branch as the primary builder and other shared-cwd agents.

Pass **`isolated_worktree: true`** when the subagent needs its own checkout (parallel experiments, isolated installs, or edits that should not touch the builder's working tree). Baguette then:

- Creates branch **`baguette/subagent/<agent_id>`** at the **committed** snapshot of the session worktree HEAD (uncommitted builder changes are not included).
- Checks out that branch in a **sibling** directory next to the session worktree: `<DATA_DIR>/repos/<stripped_name>/sessions/<session_short_id>/sub-worktrees/<agent_id>/` — never nested inside the session worktree.

`isolated_worktree` is **rejected** for global sessions and for repo sessions that have no worktree.

`StartSubagent` and `ListAgents` (subagent rows) include **`isolated_worktree`**, **`worktree_path`** (absolute path when isolated, otherwise `null`), and **`local_branch`** (the throwaway branch name when isolated, otherwise `null`).

### What isolated subagents see (`CurrentSessionInfo`)

Isolated subagents still get the **parent session** fields — `session_path`, `local_branch`, `remote_branch`, label, PR description, and the usual git helper strings — so they know which branch and PR the builder owns. They also get **`subagent_worktree_path`** and **`subagent_local_branch`** for their own checkout. **`working_directory_restrictions`** point at the sub-worktree, not `session_path`.

Shared-cwd subagents use `session_path` as both context and cwd (same as additional builders).

### Commits, merge, and push

| Mode               | Commits                                                              | Push                                                            |
| ------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Shared session cwd | Only when the delegating message **explicitly** asks to commit       | N/A — builder owns shipping                                     |
| Isolated worktree  | Commit on the throwaway branch when the task is done (or when asked) | Subagents **cannot** push — no `GitPush` tool and no shell push |

There is **no automatic merge** from a subagent branch into the session branch. When an isolated subagent finishes, the primary builder **merges** (or cherry-picks) locally, or calls **`GitPush`** with **`source_branch`** set to the subagent's local branch name to publish those commits (see below).

Subagents do not receive the **`GitPush`** MCP tool (along with other session-shipping tools such as `UpdateSession` and nested `StartSubagent`).

## Pushing changes

Two paths update the remote — they are independent.

**Post-turn auto-push (primary builder only).** When auto-push is on, Baguette pushes the **session worktree** and syncs the PR **silently** after each primary builder turn ends. Subagent turns never trigger this.

**MCP `GitPush`.** A **plain** session-branch push (no `force`, no `source_branch`, target is the session branch) with **auto-push on** runs **immediately** — the same as post-turn auto-push, so the agent should not call `GitPush` just to duplicate that. When **auto-push is off**, or the push is **not plain** (different target branch, `source_branch`, or `force`), `GitPush` **opens the Push approval modal** and waits for you to confirm.

| `GitPush` argument | Behavior                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (default)          | Push worktree **HEAD** to the session's remote branch (direct when auto-push is on; otherwise modal)                                                                    |
| `branch`           | Target branch on `origin` (default: session branch; a different branch always requires approval)                                                                        |
| `source_branch`    | Local ref to push instead of HEAD (no merge into the session worktree first); e.g. isolated subagent branch → session or shared `development`; always requires approval |
| `force`            | `lease` or `force`, both require approval in the modal                                                                                                                  |

When **`source_branch`** is pushed onto the **session branch**, Baguette first tries to **fast-forward the session worktree** to that ref. It aborts if the worktree is dirty or the source ref is not a fast-forward of the current checkout. Pushing to a **different** target does **not** move the session checkout. **`sessions.remote_branch`** in the database updates **only** when the push target is the session branch.

## Delegation and wake-ups (`agent_observers`)

Turn-end notifications are first-class subscriptions stored in the `agent_observers` table (observed agent → watcher agent, unique per pair). One mechanism covers both delegation scenarios:

- **Subagent `notify_parent`** — `StartSubagent(notify_parent: true)` inserts an observer row; when the subagent's turn ends (`completed` / `failed`), Baguette posts its result summary back to the parent agent as a user message. Use it when you will end your turn while the subagent still runs; `attach: false` returns immediately instead of waiting up to 30 minutes.
- **Cross-session watches** — one session's primary agent observes another session's primary agent. Only global sessions can observe other sessions — a repo session cannot watch the sessions it creates, so supervision belongs to a global orchestrator (repo sessions create child sessions without subscriptions). `CreateSession(notify_parent: true)` subscribes atomically when spawning; `WatchSession(session_id, notify_on?)` / `UnwatchSession(session_id)` manage subscriptions on existing sessions (idempotent). Wake-ups fire on transitions only, so `WatchSession` returns the observed agent's current status in its result — if a turn already ended (or the agent is already waiting on user input) by the time you subscribe, handle that state right away instead of waiting for a ping that will not come. Watches that would close a wake-up loop are rejected — an agent cannot observe itself, and mutual or transitive watch cycles are refused because every wake-up starts a real turn for the observer.

A wake-up message carries the observed agent's label, its status, the `/sessions/<id>` path for sessions, a truncated copy of its last assistant message, and the queued-message count. Two extras:

- **Approval pings** — when a watched agent is waiting for user input (an `AskUserQuestions` answer or a plan awaiting review), observers get a "waiting for user input" ping.
- **`notify_on: "once"`** — the subscription is consumed by the first notification.

If the watcher is mid-turn when a wake-up lands, the message queues for its next turn. `stopped` turns (user-initiated stops) and archived observer sessions never trigger messages.

## Orchestrator workflow

A global-session agent orchestrating child sessions:

1. **Start** each child with `CreateSession(notify_parent: true)`, then **end the turn** — do not block on it. User messages keep queueing normally while the children run. (To manage a session that already exists, `WatchSession` — its result includes the child's current status, so a turn that finished in the meantime can be handled right away.)
2. **Wake-ups arrive automatically** when a child's builder turn finishes or waits for user input. On a wake-up, check `GetSessionStatus` for the cheap snapshot (agent statuses, queued messages, tasks, todo/plan rollup), or `GetAgentMessages` for message bodies; check `PrRead` / `PrWorkflows` for PR/CI state.
3. **Report to the user**, coalescing several finished children into one progress report, and follow up with `CreateSessionMessage` when needed.

| Tool                                                                                         | Purpose                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CreateSession(notify_parent: true)`                                                         | Start a child session and subscribe to its turn-end notifications in one call                                                 |
| `WatchSession(session_id, notify_on?)` / `UnwatchSession(session_id)`                        | Manage turn-end subscriptions (idempotent)                                                                                    |
| `GetSessionStatus(session_id)`                                                               | Cheap progress snapshot: agent statuses, queued-message counts, last message pointers, running/failed tasks, todo/plan rollup |
| `SearchSessions`                                                                             | Fleet view — each result includes `builder_status` and `builder_agent_id`                                                     |
| `AwaitSessionTurn(session_id)`                                                               | Block up to 30 minutes for a child's current turn to finish (non-cancelling on timeout); prefer wake-ups for long waits       |
| `StopSession(session_id)`                                                                    | Stop a child session's running turns without archiving it                                                                     |
| `PrRead` / `PrComments` / `PrWorkflows` / `PrWorkflowLogs` / `ListGithubPrs` / `GetGithubPr` | Read-only PR/CI inspection for child repo sessions (pass `session_id`)                                                        |

`AwaitSessionTurn` is reserved for short synchronous waits ("wait until tests pass, then tell me") because blocking a turn prevents taking new user messages during it — wake-ups are the default tracking mechanism.

## Choosing between them

- **Code changes on one branch** → a repo session.
- **Same repo, parallel attempts or unrelated tasks** → multiple repo sessions (they get separate worktrees and PRs).
- **Background subtask _inside_ a session's work** → a subagent via `StartSubagent`.
- **Supervising several sessions, triaging, or answering cross-repo questions** → a global session as orchestrator, with `notify_parent` subscriptions for progress.

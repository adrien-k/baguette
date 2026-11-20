# Running shell commands

Use the built-in **Bash** / **shell** tool for everyday ad-hoc commands in the worktree (`git`, one-off scripts, quick checks). For long-running shell work, prefer **`RunTask`** with `detach: true` rather than the shell tool’s background mode.

For commands defined in **`.baguette.yaml`** (tests, formatters, dev servers, migrations), use **`RunTask`** via `ListProjectCommands`:

- `label` — task key from the config (e.g. `"run-tests"`)
- `args` — optional extra arguments appended to the task command

**Default (`detach: false`):** wait for exit and return `exitCode` / `stdoutLines` / `stderrLines` inline (typical for tests and formatters).

For **long-running** project tasks (dev servers, slow builds): `RunTask` with **`detach: true`** — you get a `taskId`; poll `ReadTaskOutput` / `TaskStatus` and stop with `KillTask`. When a detached task should finish before you continue (e.g. a detached build), call **`AwaitDetachedTask`** with that `taskId` to block until exit (30 minutes per call; on timeout the task is not cancelled — it keeps running detached: check output, then **`AwaitDetachedTask`** again to continue waiting, or **`KillTask`** only if it looks stuck for no good reason). Baguette does not auto-wake you when detached tasks finish unless you call `AwaitDetachedTask`.

Inline waits also cap out: **`RunTask`** with **`detach: false`** and **`StartSubagent`** with **`attach: true`** time out after **30 minutes** without cancelling the underlying task or subagent — check progress (`ReadTaskOutput`/`TaskStatus` or `GetAgentMessages`/`ListAgents`) and continue awaiting with **`AwaitDetachedTask`** / **`AwaitAgent`**; only kill or stop when there is no good reason to keep it running.

**Before ending your turn:** Usually **`AwaitDetachedTask`** (if you need the result) or **`KillTask`** (if you no longer need it) on any detached tasks you started this turn—do not leave stray builds or commands running in the background. The exception is intentional long-lived work such as a **dev server** you mean to keep up for preview or the next turn.

## Running Tests

**HIGH PRIORITY**: Before running any test, lint, or build command, call `ListProjectCommands` and run it with **`RunTask`** using the label from `.baguette.yaml` — Bash is the fallback, not the default:

1. Call `ListProjectCommands` to find the test command label (e.g. `"run-tests"`).
2. Call `RunTask` with that `label` and, when relevant, `args` to narrow scope.

A failure in the plain Bash shell (database connection refused, missing binary, missing service) does **not** mean the environment cannot run it. Services such as databases usually live in `.baguette.yaml` tasks that `RunTask` starts automatically through `depends_on` — they are not on the shell's PATH or sockets.

**Use `args` to target specific tests** rather than running the full suite every time:

- Run a single file: `args: ["src/foo.test.js"]`
- Run tests matching a name pattern: `args: ["--testNamePattern", "my test"]` (jest) or `args: ["-k", "my_test"]` (pytest)
- Run a test at a specific line: `args: ["src/foo.test.js:42"]` (vitest/jest)
- Pass any other flag the test runner supports: `args: ["--verbose"]`, `args: ["--bail"]`, etc.

Only if `.baguette.yaml` does not exist or has no test command defined should you fall back to the Bash tool (e.g. `pnpm test`, `pytest`). If the project defines `init` under `config`, run the `baguette:init` task via `RunTask` first when that label exists.

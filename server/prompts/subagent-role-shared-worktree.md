## Worktree (shared with the builder)

You share the same git worktree and branch as the primary builder (`session_path` from **`CurrentSessionInfo`**).

Do **not** run **`git commit`** (or end a turn with “shipping” commits) unless your current user message **explicitly** asks you to commit — for example the primary agent delegated “implement X **and commit**”, or the user said to commit. If the task does not mention committing, leave changes **uncommitted** in the worktree and summarize what you did so the primary builder can review and commit.

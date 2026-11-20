## Worktree (isolated)

You have your **own subagent worktree** on a throwaway branch. **`CurrentSessionInfo`** returns **`subagent_worktree_path`** (where you edit files) and **`subagent_local_branch`** (pattern `baguette/subagent/<id>`). **`session_path`**, **`local_branch`**, and **`remote_branch`** describe the **parent** session branch and PR — not your shell cwd.

Work only in **`subagent_worktree_path`**. **Commit** your changes on **`subagent_local_branch`** when your task is done (or when the user message explicitly asks you to commit along the way). Do **not** edit files in the parent session worktree (`session_path`). Do **not** run **`git push`** or call **`GitPush`** — the primary builder merges your branch into the session branch, cherry-picks, or calls **`GitPush`** with **`source_branch`** set to your branch (optionally with **`branch`** for a shared integration branch such as `development`) after you finish.

When the primary agent starts you with **`StartSubagent`** and **`isolated_worktree: true`**, Baguette provisions this worktree automatically.

# Configuration

## Data directory

All persistent data lives under a single data directory, configurable via **`DATA_DIR`** (default: `~/.baguette`). This keeps the project directory clean and makes backups and deployment predictable.

| Path                                                                          | Contents                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<DATA_DIR>/baguette.sqlite3`                                                 | SQLite database                                                              |
| `<DATA_DIR>/repos/<stripped_name>/main/`                                      | Main git clone for each repo (worktree source)                               |
| `<DATA_DIR>/repos/<stripped_name>/sessions/<session_short_id>/worktree/`      | Session git worktree (builder checkout)                                      |
| `.../sessions/<session_short_id>/sub-worktrees/<agent_id>/`                   | Optional isolated subagent worktree (sibling of `worktree/`, not inside it)  |
| `.../sessions/<session_short_id>/cursor-dir/` (and other SDK session folders) | Agent SDK data for the session — on the session folder, not in sub-worktrees |

`<stripped_name>` is derived from the repo's full name (e.g. `owner/repo-name` → `owner-repo-name`, alphanumeric and dashes only) and stored on the repo record so paths stay stable.

`repos.repo_path` in SQLite is stored **relative to `DATA_DIR`** (e.g. `repos/owner-repo-name/main`). The server resolves it at runtime; legacy absolute paths still work until migrated.

## Git worktree strategy

Each linked repository is cloned once as a normal (non-bare) checkout under `<DATA_DIR>/repos/<stripped_name>/main/`. Each session gets a git worktree at `.../sessions/<session_short_id>/worktree/`, sharing the main clone’s object store to save disk space and fetch time. Before creating a worktree, the server runs `git fetch origin` to ensure it starts from the latest remote branch. When all sessions for a repo are closed, the main clone is removed.

Optional **isolated subagents** add more worktrees under `.../sessions/<session_short_id>/sub-worktrees/<agent_id>/` on throwaway branches `baguette/subagent/<agent_id>`, created from the session worktree HEAD at spawn time. Those directories are siblings of `worktree/`, not children of it.

### Archive and subagent teardown

Archiving a session tears down isolated worktrees in order:

1. Stop tasks whose cwd is under a `sub-worktrees/<agent_id>/` path and wait until those processes exit. Tasks in the session worktree keep running.
2. `git worktree remove` each sub-worktree and **delete the throwaway local branch** (best-effort).

Deleting an isolated subagent stops tasks whose cwd is under that worktree, waits for them to exit, then removes the worktree and deletes its throwaway branch.

Throwaway subagent branches are **not** kept for restore — only the session’s own local branch can be retained when the session worktree is removed. See [subagents](sessions-and-agents.md#working-directory) for how the builder merges or pushes subagent work before teardown matters.

## Session config (`.baguette.yaml`)

Each repository can include a `.baguette.yaml` file at its root to configure per-session environment variables, initialization commands, cleanup, tasks, a dev-server proxy, and optional chat recipes. See **[Project Configuration](project-configuration.md)** for the full schema, examples, and Docker setup.

## Web Server Preview

Baguette proxies session dev servers via subdomain routing. Each session's preview is served at `session-<session_short_id>.<host>`. Preview tasks always run in the **parent session worktree** (`.../worktree/`) — isolated subagent checkouts do not host the dev proxy.

### Development

By default, local Baguette uses `DOMAIN=127.0.0.1.traefik.me` ([wildcard DNS to `127.0.0.1`](https://traefik.me/)), so previews work at `session-<id>.127.0.0.1.traefik.me` without extra DNS setup. Open the dev UI at `http://www.127.0.0.1.traefik.me:5173` (see `.env.example`).

#### Localhost (optional)

To use `*.localhost` instead, set `DOMAIN=localhost` (and matching `PUBLIC_HOST` in `.env`) and ensure wildcards resolve to `127.0.0.1`. Most systems do not support that by default — use `dnsmasq`:

**macOS (Homebrew):**

```bash
brew install dnsmasq
echo "address=/.localhost/127.0.0.1" | tee -a $(brew --prefix)/etc/dnsmasq.conf
sudo brew services start dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

**Linux (systemd-resolved or dnsmasq):**

```bash
# dnsmasq
echo "address=/.localhost/127.0.0.1" | sudo tee -a /etc/dnsmasq.conf
sudo systemctl restart dnsmasq
```

Once configured, the Baguette UI is at `www.localhost:5173` and previews at `session-<id>.localhost:5173`.

### Production

For production setup including wildcard DNS, TLS, and deployment configuration, see **[deployment.md](deployment.md)**.

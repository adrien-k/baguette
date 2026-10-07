# Configuration

## Data directory

All persistent data lives under a single data directory, configurable via **`DATA_DIR`** (default: `~/.baguette`). This keeps the project directory clean and makes backups and deployment predictable.

| Path                                                            | Contents                                       |
| --------------------------------------------------------------- | ---------------------------------------------- |
| `<DATA_DIR>/baguette.sqlite3`                                   | SQLite database                                |
| `<DATA_DIR>/repos/<stripped_name>/main/`                        | Bare clone for each repo (shared object store) |
| `<DATA_DIR>/repos/<stripped_name>/sessions/<session_short_id>/` | One worktree per session                       |

`<stripped_name>` is derived from the repo's full name (e.g. `owner/repo-name` → `owner-repo-name`, alphanumeric and dashes only) and stored on the repo record so paths stay stable.

`repos.repo_path` in SQLite is stored **relative to `DATA_DIR`** (e.g. `repos/owner-repo-name/main`). The server resolves it at runtime; legacy absolute paths still work until migrated.

## Git worktree strategy

Repositories are cloned once as bare repos under `<DATA_DIR>/repos/<stripped_name>/main/`. Each session gets a git worktree under `.../sessions/<session_short_id>/`, sharing the object store to save disk space and fetch time. Before creating a worktree, the server runs `git fetch origin` to ensure it starts from the latest remote branch. When all sessions for a repo are closed, the bare clone is removed.

## Session config (`.baguette.yaml`)

Each repository can include a `.baguette.yaml` file at its root to configure per-session environment variables, initialization commands, cleanup, tasks, and a dev-server proxy. See **[Project Configuration](project-configuration.md)** for the full schema, examples, and Docker setup.

## Web Server Preview

Baguette proxies session dev servers via subdomain routing. Each session's preview is served at `session-<session_short_id>.<host>`.

### Development - Localhost

`*.localhost` must resolve to `127.0.0.1`. Most systems do not support wildcard `.localhost` subdomains by default — use `dnsmasq`:

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

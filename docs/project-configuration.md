# Project Configuration

Baguette uses **`.baguette.yaml`** at the repository root to configure per-session environments, tasks, and the dev server preview.

> **Tip:** The easiest way to configure your project is to ask Baguette directly. It has full context about your repo and can generate **`.baguette.yaml`** for you (including `type: docker` tasks for databases and caches) and optional **`.baguette/`** helper files when needed.

## Docker services (PostgreSQL, Redis, etc.)

Define databases and other dependencies as **docker tasks** in `session.tasks`. Baguette provisions a per-session Docker volume `baguette_session_<short_id>`, starts the container on the `baguette_default` Docker network, waits for a health check (if configured), and removes the volume when the session is archived.

### Docker task fields

| Field                   | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `type`                  | Must be `docker`                                                                     |
| `env`                   | Container environment variables (passed to `docker run -e`)                          |
| `container.image`       | Docker image to run                                                                  |
| `container.persist`     | Paths inside the container mounted on the session volume                             |
| `container.healthcheck` | Optional Docker health check (`test`, `interval`, `timeout`, `retries`)              |
| `depends-on`            | Other task keys that must be ready before this task starts (unusual for DB services) |

Put connection URLs (e.g. `DATABASE_URL`) in **task `env`** on each command task that uses the database, with **`depends-on: [<docker-task-key>]`** so the container is running first. Use `${{ baguette.tasks.<task-key>.container_hostname }}` and the image’s container port (e.g. `5432` for Postgres). Do not put docker-backed URLs in `session.env` — they belong on tasks that depend on the service. With `persist`, the database name does not need `short_id` — each session has its own data directory (e.g. database `app`).

## Quick start

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      pnpm install
    tasks:
      postgres:
        type: docker
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        container:
          image: postgres:16
          persist: ['/var/lib/postgresql/data']
          healthcheck:
            test: ['CMD-SHELL', 'pg_isready -U postgres']
            interval: 5s
            timeout: 3s
            retries: 10
      run-tests:
        run: pnpm run db:migrate && pnpm test
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:postgres@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      reset-db:
        run: pnpm run db:reset
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:postgres@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      dev-server:
        run: pnpm run db:migrate && pnpm run dev --port $VITE_PORT --host 127.0.0.1
        ports: [VITE_PORT]
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:postgres@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
  webserver:
    task: dev-server
    expose: VITE_PORT
```

## Full schema

```yaml
config:
  session:
    env: # Key-value env vars injected into every task and Claude session
    init: # Multi-line script run once when a session starts
    cleanup: # Multi-line script run when a session is closed
    tasks: # Hash of named tasks (replaces legacy `commands` array)
      <task-key>:
        run: <shell command>
        ports: [ENV_VAR_NAME, ...] # Optional: env vars assigned free ports
        depends-on: [<other-task-key>] # Optional: tasks to start first
  # Use one of webserver OR services — they are mutually exclusive.
  webserver:
    task: <task-key> # Reference a task from session.tasks
    expose: ENV_VAR # Which port env var users access in the browser
  services: # Multi-service: each gets its own subdomain
    <service-name>:
      task: <task-key>
      expose: ENV_VAR
```

## `session` block

### `env`

Environment variables injected into all session tasks (init, cleanup, commands, webserver) and Claude's shell.

Supports placeholders:

| Placeholder                                           | Description                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `${{ baguette.secrets.KEY }}`                         | Secret stored in Settings > Secrets                                                                                                     |
| `${{ baguette.session.short_id }}`                    | Unique 4-character hex identifier for this session                                                                                      |
| `${{ baguette.session.public_uri }}`                  | Public URL of the webserver (or portal URL for multi-service)                                                                           |
| `${{ baguette.services.<name>.public_uri }}`          | Public URL of a specific named service (multi-service only)                                                                             |
| `${{ baguette.tasks.<task-key>.container_hostname }}` | Docker network hostname for a `type: docker` task — use in **task `env`** on tasks with `depends-on` (resolved from session `short_id`) |
| `${{ baguette.tasks.<task-key>.<PORT> }}`             | Host port from a **command** task with `ports:` — resolved when a task with `depends-on` starts (not in `session.cleanup`)              |

### `init`

Shell commands run **once on the first task start** (after worktree creation). The block runs as a shell script under `set -e`, so the first failing command aborts it and the task fails to start.

On that first start, Baguette runs `session.init`, then the requested task's `depends-on` chain (e.g. docker Postgres), then the task itself. Use **`init` for install-only steps** (e.g. `pnpm install`, `bundle install`). Do **not** run database create, migrate, prepare, or reset in `init` — put those on tasks that list `depends-on: [postgres]` (or your DB task) so Postgres is running before they connect.

```yaml
init: |
  pnpm install
```

### `cleanup`

Shell commands run when a session is closed, before the worktree is removed. Errors are logged but do not prevent cleanup.

Cleanup runs as a one-off shell task: it does **not** start docker `depends-on` tasks and does **not** resolve `${{ baguette.tasks.* }}` placeholders in `session.env`. Do not rely on `cleanup` to drop a database that lives in a **docker** task with `persist` — Baguette removes the session volume `baguette_session_<short_id>` when the session is archived. Use `cleanup` for worktree-local files, shared external databases (with a connection string that does not need task port placeholders), or other resources outside docker volumes.

### `tasks`

A hash of named tasks available in the session. Each key is the task name, used as the label in the UI and MCP tools.

```yaml
tasks:
  run-tests:
    run: pnpm test
  dev-server:
    run: pnpm run dev --port $VITE_PORT --host 127.0.0.1
    ports: [VITE_PORT, API_PORT]
  e2e-tests:
    run: pnpm run e2e --base-url http://127.0.0.1:${{ baguette.tasks.dev-server.VITE_PORT }}
    depends-on: [dev-server]
```

#### Task fields

| Field        | Type     | Description                                                                                     |
| ------------ | -------- | ----------------------------------------------------------------------------------------------- |
| `run`        | string   | Shell command to execute (see [multi-line tasks](#multi-line-tasks))                            |
| `type`       | string   | `docker` to run a container instead of `run`                                                    |
| `ports`      | string[] | Env var names that Baguette assigns free ports to before launching                              |
| `depends-on` | string[] | Task keys that must be running and listening before this task starts                            |
| `env`        | object   | Per-task env vars merged over `session.env` (use for `DATABASE_URL` with docker `depends-on`)   |
| `attach`     | boolean  | When `false`, `RunProjectCommand` rejects `attach: true` (use detached mode + `ReadTaskOutput`) |
| `container`  | object   | Docker image, persist paths, healthcheck (when `type: docker`)                                  |

#### Multi-line tasks

A single-line `run` is executed with `sh -c`. A multi-line `run` (and the `init` / `cleanup` blocks) is written to a script file and executed, so the block keeps its own shell semantics: `if`/`for`, heredocs, comments, and variables set on one line and used on the next all work as written.

```yaml
tasks:
  reset-db:
    run: |
      # a comment, not a broken command
      if [ -f ./.data/app.sqlite3 ]; then
        rm ./.data/app.sqlite3
      fi
      pnpm run migrate
```

The script runs under `set -e`, so the task stops at the first failing command. To choose a different interpreter, start the block with a shebang:

```yaml
run: |
  #!/usr/bin/env bash
  set -euo pipefail
  shopt -s globstar
  ./scripts/check.sh **/*.ts
```

#### Lifetime

Task lifetime is determined by whether the task exposes ports — it is not configurable in `.baguette.yaml`:

- **No ports** — the task runs until it exits or is cancelled. Heartbeats have no effect.
- **Has ports** — the task is stopped after 5 minutes of inactivity. A heartbeat resets that window to 5 minutes. The preview proxy heartbeats the underlying task on every proxied request. Each running task also heartbeats its `depends-on` tasks every minute until it exits, so a long-running command keeps its server dependencies alive.

#### Ports

When a task has `ports`, Baguette allocates a free TCP port for each env var name before spawning the process. The command can reference these ports via standard env var syntax (e.g. `$PORT`, `$VITE_PORT`).

#### Dependencies (`depends-on`)

When a task declares `depends-on`, Baguette ensures each dependency task is running and all its ports are listening before starting the dependent task. If a dependency isn't running, Baguette starts it automatically.

Docker dependencies expose `${{ baguette.tasks.<docker-task-key>.container_hostname }}` in **task `env`** on tasks that list `depends-on` (e.g. `DATABASE_URL` for Postgres). Command-task ports are available in the dependent task's `run` and `task.env` after dependencies are ready:

```
${{ baguette.tasks.<task-key>.<PORT_ENV_VAR> }}
```

For example, if `dev-server` has `ports: [VITE_PORT]` and is allocated port 54321, then `${{ baguette.tasks.dev-server.VITE_PORT }}` resolves to `54321`.

Circular dependencies are detected and rejected with an error.

## `preview.scheme` (deep links)

Optional custom URL scheme for preview deep links (e.g. Expo `exp://`). Set globally under `preview`, or override per `webserver` / `services.<name>`:

```yaml
config:
  preview:
    scheme: exp://
  webserver:
    task: dev-server
    expose: VITE_PORT
```

For multi-service setups:

```yaml
services:
  expo:
    task: expo
    expose: EXPO_PORT
    scheme: exp://
```

Baguette builds a deep link by replacing the `https://` prefix of the service preview URL with the configured scheme (e.g. `https://session-<id>-expo.<domain>/` → `exp://session-<id>-expo.<domain>/`). On the session **Preview** tab, **Open preview** and the QR code use that deep link when a scheme is configured.

## `services` block (multi-service preview)

Use `services` instead of `webserver` when the project has **multiple services that each need their own independent public URL** — the primary case is a mobile app (e.g., Expo/React Native) whose runtime directly calls an API backend. Each service gets its own subdomain `session-<id>-<name>.<domain>`. A portal page at `session-<id>.<domain>` lists all services with live status and logs.

> **Do NOT use `services`** just because a project has a frontend and a backend: if the frontend proxies API calls via Vite's `proxy` config, Next.js rewrites, etc., a single `webserver` entry is correct.

`services` and `webserver` are mutually exclusive.

```yaml
config:
  session:
    tasks:
      frontend:
        run: pnpm dev --port $PORT --host 127.0.0.1
        ports: [PORT]
      api:
        run: node server.js --port $API_PORT
        ports: [API_PORT]
  services:
    frontend:
      task: frontend
      expose: PORT
      description: Vite web app — open in the browser
    api:
      task: api
      expose: API_PORT
      description: JSON API for the mobile client
```

### Service URL placeholders

Each service gets a `${{ baguette.services.<name>.public_uri }}` placeholder you can use in `session.env`:

```yaml
session:
  env:
    EXPO_PUBLIC_API_URL: '${{ baguette.services.api.public_uri }}'
    PUBLIC_HOST: '${{ baguette.services.api.public_uri }}'
```

- Service names must be lowercase alphanumeric + hyphens (e.g. `api`, `expo`, `web-app`).
- **`description`** (optional): short text shown on the multi-service portal and the session Preview tab.
- `${{ baguette.session.public_uri }}` still works and points to the portal URL.

### Expo + API backend example

Expo needs to call an API backend. The Expo metro bundler bakes the API URL into the JS bundle at startup — so the mobile device calls a real public URL, not localhost. Each must have its own subdomain:

```yaml
config:
  session:
    env:
      EXPO_PUBLIC_API_URL: '${{ baguette.services.api.public_uri }}'
      PUBLIC_HOST: '${{ baguette.services.api.public_uri }}'
    init: |
      pnpm install
    tasks:
      postgres:
        type: docker
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        container:
          image: postgres:16
          persist: ['/var/lib/postgresql/data']
          healthcheck:
            test: ['CMD-SHELL', 'pg_isready -U postgres']
            interval: 5s
            timeout: 3s
            retries: 10
      api:
        run: pnpm --filter api run db:migrate && pnpm --filter api run dev --port $API_PORT --host 127.0.0.1
        ports: [API_PORT]
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:postgres@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      expo:
        run: pnpm --filter expo run start --port $EXPO_PORT --host 127.0.0.1
        ports: [EXPO_PORT]
        depends-on: [api]
  services:
    api:
      task: api
      expose: API_PORT
    expo:
      task: expo
      expose: EXPO_PORT
```

- `depends-on: [api]` ensures the API is listening before Expo starts.
- The portal at `session-<shortId>.<domain>` shows both services with status and logs.
- Opening `session-<shortId>-expo.<domain>` shows the Expo dev tools; `session-<shortId>-api.<domain>` is the API.

---

## `webserver` block

Configures the dev server that Baguette proxies for live preview. Reference a task defined in `session.tasks`:

```yaml
session:
  tasks:
    dev-server:
      run: pnpm run dev --port $VITE_PORT --host 127.0.0.1
      ports: [VITE_PORT]
webserver:
  task: dev-server
  expose: VITE_PORT
  description: Local Vite dev server (UI)
```

- **`task`**: the key of a task in `session.tasks`. The task's `run` and `ports` are used to start the dev server.
- **`expose`**: which port env var users access in the browser. Must be one of the task's port env var names.
- **`description`** (optional): short text shown on the session Preview tab.

### Port readiness

Baguette polls all allocated ports until they are listening on 127.0.0.1 before marking the dev server as ready. If no port is listening within 1 minute, the preview shows a timeout error.

### Best practices

- **Bind to `127.0.0.1`** — configure the dev server to listen on 127.0.0.1 explicitly, not just `localhost`.
- **Allow the baguette public URI** — add `PUBLIC_HOST` to your session env and configure your framework to accept it as an allowed host.
- See the [session management docs](session-management.md#web-server-preview) for DNS and production setup.

## MCP tools

Baguette exposes these MCP tools for task management:

| Tool                  | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `ListProjectCommands` | List all available tasks from `.baguette.yaml`         |
| `RunProjectCommand`   | Run a task by label, with optional args                |
| `ListRunningTasks`    | List currently running tasks with ports                |
| `KillTask`            | Kill a running task by ID                              |
| `ReadTaskOutput`      | Read log output of a task (supports startByte/endByte) |

## Examples

### Rails + Vite

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      bundle install
      pnpm install
    tasks:
      postgres:
        type: docker
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: '${{ baguette.secrets.PG_PASSWORD }}'
        container:
          image: postgres:16
          persist: ['/var/lib/postgresql/data']
      run-tests:
        run: bundle exec rails db:reset && bundle exec rspec
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      rails-server:
        run: bundle exec rails db:prepare && rails server -b 127.0.0.1 -p $RAILS_PORT
        ports: [RAILS_PORT]
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      vite-dev:
        run: VITE_API_URL=http://127.0.0.1:${{ baguette.tasks.rails-server.RAILS_PORT }} pnpm run dev --port $VITE_PORT --host 127.0.0.1
        ports: [VITE_PORT]
        depends-on: [rails-server]
  webserver:
    task: vite-dev
    expose: VITE_PORT
```

### Django

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      pip install -r requirements.txt
    tasks:
      postgres:
        type: docker
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: '${{ baguette.secrets.PG_PASSWORD }}'
        container:
          image: postgres:16
          persist: ['/var/lib/postgresql/data']
      run-tests:
        run: python manage.py migrate && python manage.py test
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      dev-server:
        run: python manage.py migrate && python manage.py runserver 127.0.0.1:$PORT
        ports: [PORT]
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
  webserver:
    task: dev-server
    expose: PORT
```

# Project Configuration

Baguette uses **`.baguette.yaml`** at the repository root to configure per-session environments, tasks, and the dev server preview.

> **Tip:** The easiest way to configure your project is to ask Baguette directly. It has full context about your repo and can generate **`.baguette.yaml`** for you (including `type: docker` tasks for databases and caches) and optional **`.baguette/`** helper files when needed.

## Docker services (PostgreSQL, Redis, etc.)

Define databases and other dependencies as **docker tasks** in `session.tasks`. Baguette provisions a per-session Docker volume `baguette_session_<short_id>`, starts the container on the `baguette_default` Docker network, waits for a health check (if configured), and on archive removes session containers, **images built for that session** (`container.build`), and the data volume. Pulled images such as `postgres:16` are not removed.

Docker tasks **do not use `ports:`**. They are not published to random host ports. Other tasks (your app, migrations, tests) reach them on the Docker network at `${{ baguette.tasks.<task-key>.container_hostname }}` using the **normal port the image listens on inside the container** (e.g. `5432` for Postgres, `6379` for Redis). Reserve dynamic `ports:` for **command** tasks that must listen on the session host (dev servers, APIs proxied to the browser).

### Docker task fields

| Field                   | Description                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                  | Must be `docker`                                                                                                                                    |
| `env`                   | Container environment variables (passed to `docker run -e`)                                                                                         |
| `container.image`       | Docker image to run (or tag for a built image when `container.build` is set); supports [env placeholders](#env)                                     |
| `container.build`       | Build the image from the repo before `docker run` (path string or `context` / `dockerfile` / `args` / `target`; string fields support placeholders) |
| `container.persist`     | Paths inside the container mounted on the session volume (placeholders supported)                                                                   |
| `container.command`     | Override the image default command (string runs via `sh -c`, or a argv list; placeholders supported)                                                |
| `container.healthcheck` | Optional Docker health check (`test`, `interval`, `timeout`, `retries`; `test` supports placeholders)                                               |
| `depends-on`            | Other task keys that must be ready before this task starts (unusual for DB services)                                                                |

Put connection URLs (e.g. `DATABASE_URL`) in **task `env`** on each command task that uses the database, with **`depends-on: [<docker-task-key>]`** so the container is running first. Use `${{ baguette.tasks.<task-key>.container_hostname }}` and the image’s **container** port (e.g. `:5432` for Postgres) — not `${{ baguette.tasks.<task-key>.PG_PORT }}` or other dynamic host port placeholders. Do not put docker-backed URLs in `session.env` — they belong on tasks that depend on the service. With `persist`, the database name does not need `short_id` — each session has its own data directory (e.g. database `app`).

## Quick start

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.services.app.public_uri }}'
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
  services:
    app:
      task: dev-server
      expose: VITE_PORT
```

## `session` block

### `env`

Environment variables injected into all session tasks (init, cleanup, commands, preview services) and the coding agent's shell.

**`session.env` must not use `${{ baguette.tasks.* }}` placeholders** — starting a task will fail with an explicit error. Put docker URLs, host ports, and other task-specific values in each task’s own `env` block with `depends-on`.

Session-level placeholders (resolved when the task is created):

| Placeholder                                  | Description                                        |
| -------------------------------------------- | -------------------------------------------------- |
| `${{ baguette.secrets.KEY }}`                | Secret stored in Settings > Secrets                |
| `${{ baguette.session.short_id }}`           | Unique 4-character hex identifier for this session |
| `${{ baguette.services.<name>.public_uri }}` | Public URL of a named entry in `services`          |

**Task `env`** (per task under `session.tasks`) also supports the session placeholders above, plus task-specific placeholders resolved **after `depends-on` tasks are ready**:

| Placeholder                                           | Description                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `${{ baguette.tasks.<task-key>.container_hostname }}` | Docker network hostname — the `<task-key>` must exist and be listed in `depends-on`                                        |
| `${{ baguette.tasks.<task-key>.<PORT> }}`             | Host port from a command task that declares `ports:` — same `depends-on` requirement; unknown task keys fail at task start |

Other config strings (`run`, docker `container`, `services`, etc.) use the same two-phase rules: session placeholders at task start, task port/host placeholders after dependencies are ready.

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

A hash of named tasks available in the session. Each key is the task name, used as the label in the UI.

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

| Field        | Type     | Description                                                                                                                      |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `run`        | string   | Shell command to execute (see [multi-line tasks](#multi-line-tasks))                                                             |
| `type`       | string   | `docker` to run a container instead of `run`                                                                                     |
| `ports`      | string[] | For **command** tasks only: env var names that Baguette assigns free **host** ports to before launching (omit on `type: docker`) |
| `depends-on` | string[] | Task keys that must be running and listening before this task starts                                                             |
| `env`        | object   | Per-task env vars merged over `session.env` (use for `DATABASE_URL` with docker `depends-on`)                                    |
| `attach`     | boolean  | When `false`, detached mode is required to run the task (logs via task output APIs)                                              |
| `internal`   | boolean  | When `true`, omit from session task buttons (task remains runnable via `task_key`, `depends-on`, `services`, etc.)               |
| `container`  | object   | Docker image, persist paths, healthcheck (when `type: docker`)                                                                   |

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

Task lifetime is not configurable in `.baguette.yaml`. It depends on how the task was started:

- **Tasks panel or Preview tab (manual start)** — run until they exit or are cancelled.
- **Preview link (dev proxy auto-start)** — the preview service task is stopped after **15 minutes** of inactivity.
- **`depends-on` tasks** — stopped after **15 minutes** of inactivity while a parent task is running. Reused tasks keep whatever lifetime they were created with (for example, a postgres container started from the panel is not upgraded to idle TTL when preview reuses it).

Docker tasks follow the same rules based on how they were started, not on whether they expose host ports.

#### Ports

**Command tasks** with `ports` get a free TCP port on the session host for each listed env var before the process starts. The command references them via `$PORT`, `$VITE_PORT`, etc., and dependents can use `${{ baguette.tasks.<task-key>.VITE_PORT }}`.

**Docker tasks** do not use `ports`. Dependent command tasks connect over the `baguette_default` network using `container_hostname` and the port the container image already exposes (e.g. `postgres://…@${{ baguette.tasks.postgres.container_hostname }}:5432/…`).

#### Dependencies (`depends-on`)

When a task declares `depends-on`, Baguette starts each dependency if needed and waits until it is ready before starting the dependent task. If a dependency isn't running, Baguette starts it automatically.

- **Docker dependency** — ready when the container has started (and, if `container.healthcheck` is set in YAML, when Docker reports healthy). No host port polling.
- **Command dependency with `ports`** — ready when every allocated host port is listening on `127.0.0.1`.

Docker dependencies are reached via `${{ baguette.tasks.<docker-task-key>.container_hostname }}` in **task `env`** (plus the image’s container port). **Command-task** host ports are available in the dependent task's `run` and `task.env` after dependencies are ready:

```
${{ baguette.tasks.<task-key>.<PORT_ENV_VAR> }}
```

For example, if `dev-server` has `ports: [VITE_PORT]` and is allocated port 54321, then `${{ baguette.tasks.dev-server.VITE_PORT }}` resolves to `54321`.

Circular dependencies are detected and rejected with an error.

## `services` block (preview)

The **`services`** block defines which tasks Baguette proxies for live preview. Each entry maps a service name to a `session.tasks` key and the port env var users reach in the browser.

| Field         | Description                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task`        | Key of a task in `session.tasks` (that task’s `run` and `ports` start the preview process)                                                                 |
| `expose`      | Which port env var from the task’s `ports` list is proxied to the public URL (required)                                                                    |
| `description` | Optional short text on the session Preview tab                                                                                                             |
| `scheme`      | Optional custom URL scheme for deep links (e.g. `exp://` for Expo). Open preview and QR codes use this scheme with the service host instead of `https://`. |

Service names must be lowercase alphanumeric + hyphens (e.g. `app`, `api`, `expo`). The name `vscode` is reserved.

Each service is proxied at `session-<id>-<name>.<domain>`. Use `${{ baguette.services.<name>.public_uri }}` when a task or `session.env` value needs that URL (for example `PUBLIC_HOST` for allowed-host checks).

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.services.app.public_uri }}'
    tasks:
      dev-server:
        run: pnpm dev --port $PORT --host 127.0.0.1
        ports: [PORT]
  services:
    app:
      task: dev-server
      expose: PORT
      description: Vite dev server
```

```yaml
config:
  session:
    env:
      EXPO_PUBLIC_API_URL: '${{ baguette.services.api.public_uri }}'
      PUBLIC_HOST: '${{ baguette.services.api.public_uri }}'
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

### Port readiness

Baguette polls all allocated ports until they are listening on `127.0.0.1` before marking a preview service as ready. If no port is listening within 1 minute, the preview shows a timeout error.

### Best practices

- **Bind to `127.0.0.1`** — configure the dev server to listen on 127.0.0.1 explicitly, not just `localhost`.
- **Allowed hosts** — set `PUBLIC_HOST` from `${{ baguette.services.<name>.public_uri }}` in `session.env` and configure your framework to accept it.
- See the [session management docs](session-management.md#web-server-preview) for DNS and production setup.

### Expo + API backend example

Expo needs to call an API backend. The Expo metro bundler bakes the API URL into the JS bundle at startup — so the mobile device calls a real public URL, not localhost:

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
      scheme: exp://
```

- `depends-on: [api]` ensures the API is listening before Expo starts.

---

## Examples

### Rails + Vite

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.services.app.public_uri }}'
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
  services:
    app:
      task: vite-dev
      expose: VITE_PORT
```

### Django

```yaml
config:
  session:
    env:
      PUBLIC_HOST: '${{ baguette.services.app.public_uri }}'
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
  services:
    app:
      task: dev-server
      expose: PORT
```

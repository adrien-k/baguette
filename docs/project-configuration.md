# Project Configuration

Baguette uses a `.baguette.yaml` file at the root of your repository to configure per-session environments, tasks, and the dev server preview.

> **Tip:** The easiest way to configure your project is to ask Baguette directly. It has full context about your repo and can generate the Docker and `.baguette.yaml` configuration for you. It will update the Docker settings and create a PR with the updated `.baguette.yaml` file.

## Docker configuration

In the Baguette **Admin > Settings** panel, you can define a `docker-compose` configuration that runs alongside every session. This is where you add databases, caches, or any other services your project needs.

For example, to add PostgreSQL:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:

networks:
  default:
```

The services defined here are available to all sessions via their service name as hostname (e.g. `postgres:5432`).

## Quick start

```yaml
config:
  session:
    env:
      # Credentials match the postgres Docker service defined in Admin > Settings
      DATABASE_URL: 'postgres://postgres:postgres@postgres:5432/app_${{ baguette.session.short_id }}'
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      pnpm install
      pnpm run db:migrate
    cleanup: |
      pnpm run db:drop
    tasks:
      run-tests:
        run: pnpm test
      reset-db:
        run: pnpm run db:drop && pnpm run db:migrate
      dev-server:
        run: pnpm run dev --port $VITE_PORT --host 127.0.0.1
        ports: [VITE_PORT]
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
        ttl: <seconds> # Optional: task lifetime in seconds (default: 900)
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

| Placeholder                                  | Description                                                   |
| -------------------------------------------- | ------------------------------------------------------------- |
| `${{ baguette.secrets.KEY }}`                | Secret stored in Settings > Secrets                           |
| `${{ baguette.session.short_id }}`           | Unique 4-character hex identifier for this session            |
| `${{ baguette.session.public_uri }}`         | Public URL of the webserver (or portal URL for multi-service) |
| `${{ baguette.services.<name>.public_uri }}` | Public URL of a specific named service (multi-service only)   |

### `init`

Shell commands run once when a session starts (after worktree creation, before the first task). Lines are joined with `&&`. If any command fails, session creation fails.

```yaml
init: |
  pnpm install
  pnpm run db:create
  pnpm run db:migrate
```

### `cleanup`

Shell commands run when a session is closed, before the worktree is removed. Errors are logged but do not prevent cleanup.

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

| Field        | Type     | Description                                                                                                                                               |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`        | string   | Shell command to execute                                                                                                                                  |
| `ports`      | string[] | Env var names that Baguette assigns free ports to before launching                                                                                        |
| `depends-on` | string[] | Task keys that must be running and listening before this task starts                                                                                      |
| `ttl`        | number   | Task lifetime in seconds before it is automatically stopped (default: 900). For webserver/service tasks, each incoming HTTP request resets the countdown. |

#### Ports

When a task has `ports`, Baguette allocates a free TCP port for each env var name before spawning the process. The command can reference these ports via standard env var syntax (e.g. `$PORT`, `$VITE_PORT`).

#### Dependencies (`depends-on`)

When a task declares `depends-on`, Baguette ensures each dependency task is running and all its ports are listening before starting the dependent task. If a dependency isn't running, Baguette starts it automatically.

Dependency ports are available as template variables in the dependent task's `run` command:

```
${{ baguette.tasks.<task-key>.<PORT_ENV_VAR> }}
```

For example, if `dev-server` has `ports: [VITE_PORT]` and is allocated port 54321, then `${{ baguette.tasks.dev-server.VITE_PORT }}` resolves to `54321`.

Circular dependencies are detected and rejected with an error.

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
    api:
      task: api
      expose: API_PORT
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
- `${{ baguette.session.public_uri }}` still works and points to the portal URL.

### Expo + API backend example

Expo needs to call an API backend. The Expo metro bundler bakes the API URL into the JS bundle at startup — so the mobile device calls a real public URL, not localhost. Each must have its own subdomain:

```yaml
config:
  session:
    env:
      DATABASE_URL: 'postgres://postgres:postgres@postgres:5432/app_${{ baguette.session.short_id }}'
      EXPO_PUBLIC_API_URL: '${{ baguette.services.api.public_uri }}'
      PUBLIC_HOST: '${{ baguette.services.api.public_uri }}'
    init: |
      pnpm install
      pnpm --filter api run db:migrate
    cleanup: |
      pnpm --filter api run db:drop
    tasks:
      api:
        run: pnpm --filter api run dev --port $API_PORT --host 127.0.0.1
        ports: [API_PORT]
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
```

- **`task`**: the key of a task in `session.tasks`. The task's `run` and `ports` are used to start the dev server.
- **`expose`**: which port env var users access in the browser. Must be one of the task's port env var names.

### Port readiness

Baguette polls all allocated ports until they are listening on 127.0.0.1 before marking the dev server as ready. If no port is listening within 1 minute, the preview shows a timeout error.

### Best practices

- **Bind to `127.0.0.1`** — configure the dev server to listen on 127.0.0.1 explicitly, not just `localhost`.
- **Allow the baguette public URI** — add `PUBLIC_HOST` to your session env and configure your framework to accept it as an allowed host.
- See the [session management docs](session-management.md#web-server-preview) for DNS and production setup.

## MCP tools

Baguette exposes these MCP tools for task management:

| Tool                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `ListProjectCommands` | List all available tasks from `.baguette.yaml`    |
| `RunProjectCommand`   | Run a task by label, with optional args           |
| `ListRunningTasks`    | List currently running tasks with ports           |
| `KillTask`            | Kill a running task by ID                         |
| `ReadTaskOutput`      | Read log output of a task (supports offset/limit) |

## Examples

### Rails + Vite

```yaml
config:
  session:
    env:
      DATABASE_URL: 'postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@postgres:5432/app_${{ baguette.session.short_id }}'
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      bundle install
      pnpm install
      rails db:create db:migrate db:seed
    cleanup: |
      rails db:drop
    tasks:
      run-tests:
        run: bundle exec rspec
      rails-server:
        run: rails server -b 127.0.0.1 -p $RAILS_PORT
        ports: [RAILS_PORT]
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
      DATABASE_URL: 'postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@postgres:5432/app_${{ baguette.session.short_id }}'
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      pip install -r requirements.txt
      python manage.py migrate
    cleanup: |
      python manage.py flush --no-input
    tasks:
      run-tests:
        run: python manage.py test
      dev-server:
        run: python manage.py runserver 127.0.0.1:$PORT
        ports: [PORT]
  webserver:
    task: dev-server
    expose: PORT
```

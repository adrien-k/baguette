Check if `.baguette.yaml` already exists at the project root. If it does, review it and update it as needed. If it does not exist, create it from scratch.

## .baguette.yaml Format

```yaml
config:
  session:
    env:
      # Environment variables injected into every session.
      # Use ${{ baguette.secrets.SECRET_NAME }} to reference secrets stored in Settings > Secrets.
      # Use ${{ baguette.services.<name>.public_uri }} for a preview service's public URL.
      NEXT_PUBLIC_APP_URL: '${{ baguette.services.app.public_uri }}'
      PUBLIC_HOST: '${{ baguette.services.app.public_uri }}'
    init: |
      # Runs once on first task start, before depends-on tasks (e.g. docker Postgres).
      # Install-only — run migrations on a task that depends-on the database.
      # Prefer pnpm over npm/yarn to preserve disk storage via its global content-addressable cache.
      pnpm install
    # cleanup: optional — omit when using docker Postgres with `persist` (volume removed on archive).
    # Task port placeholders in session.env are not resolved during cleanup.
    tasks:
      # Named tasks available in the session UI and MCP tools.
      # Each key is the task name (used as label).
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
        run: pnpm run db:migrate && pnpm dev --port $VITE_PORT --host 127.0.0.1
        # List of env var names that baguette will assign free ports to before launching.
        # The command must use these env vars instead of hardcoded ports.
        ports: [VITE_PORT, RAILS_PORT]
        depends-on: [postgres]
        env:
          DATABASE_URL: 'postgres://postgres:postgres@${{ baguette.tasks.postgres.container_hostname }}:5432/app'
      e2e-tests:
        run: pnpm run e2e --base-url http://127.0.0.1:${{ baguette.tasks.dev-server.VITE_PORT }}
        # depends-on ensures the dependency task is running and its ports are listening.
        depends-on: [dev-server]
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
  services:
    app:
      task: dev-server
      expose: VITE_PORT
```

> **Legacy format**: You can also use an array-based `commands` format instead of `tasks`:
>
> ```yaml
> commands:
>   - label: Run tests
>     run: pnpm test
> ```

## services block (preview)

Each entry maps a service name to a `session.tasks` key and the port env var users reach in the browser.

- **task**: reference a task key from `session.tasks` (that task's `run` and `ports` start the preview process).
- **expose**: which port env var from the task's `ports` list is proxied publicly (required).
- **description**: optional short text on the session Preview tab.
- **scheme**: optional custom URL scheme for deep links (e.g. `exp://` on an Expo service).

Each service is proxied at `session-<id>-<name>.<domain>`. With multiple services, a portal at `session-<id>.<domain>` lists them all.

```yaml
config:
  session:
    env:
      # Wire each service's public URL into the env so processes can reference them.
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

- `${{ baguette.services.api.public_uri }}` resolves to `https://session-<shortId>-api.<domain>/`
- Service names must be lowercase alphanumeric + hyphens (e.g. `api`, `expo`, `web-app`).
- `depends-on: [api]` ensures the API is listening before Expo starts (important: Expo bakes the API URL into the bundle at startup).

## tasks block fields

Each task in `session.tasks` supports:

- **run**: the shell command to execute (command tasks)
- **type**: `docker` to run a container instead of `run`
- **ports**: (optional, **command tasks only**) env var names that Baguette assigns free **host** ports to before launching — use for dev servers and other processes the preview proxy must reach. **Do not** add `ports` to docker tasks (Postgres, Redis, etc.).
- **depends-on**: (optional) list of task keys that must be ready before this task starts. Command tasks that use a docker database must list `depends-on: [postgres]` (or your DB task key).
- **env**: (optional) per-task environment variables, merged on top of `session.env`. Put **`DATABASE_URL` and other docker connection URLs here** (not in `session.env`), using `${{ baguette.tasks.<docker-task>.container_hostname }}` and the **container’s normal listen port** (e.g. `:5432`, `:6379`) — not dynamic `${{ baguette.tasks.<docker-task>.PG_PORT }}` placeholders. Also supports `${{ baguette.secrets.X }}`, `${{ baguette.session.public_uri }}`, `${{ baguette.services.<name>.public_uri }}`, and `${{ baguette.tasks.<command-task-key>.<PORT_NAME> }}` for **command** tasks that declare `ports`.
- **internal**: (optional) when `true`, the task is omitted from session task buttons and `ListProjectCommands` (it remains available for `depends-on`, `services` references, and `RunProjectCommand` by label).

```yaml
tasks:
  dev-server:
    run: pnpm dev --port $VITE_PORT
    ports: [VITE_PORT]
    env:
      NODE_ENV: development
      API_KEY: '${{ baguette.secrets.DEV_API_KEY }}'
  run-tests:
    run: pnpm run db:migrate && pnpm test
    depends-on: [postgres]
    env:
      NODE_ENV: test
      DATABASE_URL: 'postgres://user:${{ baguette.secrets.DB_PASSWORD }}@${{ baguette.tasks.postgres.container_hostname }}:5432/app_test'
```

## Your Task

0. **Set up mise** (tool version manager):
   - Check if `.mise.toml` or `.tool-versions` exists at the project root
   - If neither exists, detect the required tool versions from the project (e.g. `.nvmrc`, `.ruby-version`, `.python-version`, `package.json` `engines` field, etc.) and create a `.mise.toml` with the appropriate major versions (e.g. `[tools]\nnode = "20"`)
   - Run `mise install` to activate and install the declared tools

1. **Inspect the project** to understand its setup:
   - Read `README.md` for setup instructions
   - Check `package.json` (or `Gemfile`, `requirements.txt`, `go.mod`, etc.) for dependencies and scripts
   - Look at `.env.example`, `.env.sample`, or any `.env.*` files for required environment variables
   - Check for `Makefile`, `docker-compose.yml`, `Procfile`, or similar orchestration files
   - Look at the project structure to identify the tech stack

2. **Configure the session block**:
   - Set `session.env` for values shared across the session (e.g. `PUBLIC_HOST`, framework public URLs). Put **`DATABASE_URL` on task `env`** for each command task that connects to a docker database, with `depends-on` on that docker task — not in `session.env`.
   - For **shared** databases (no docker `persist` volume), use `${{ baguette.session.short_id }}` in database names to isolate sessions (e.g. `myapp_${{ baguette.session.short_id }}`). With a **docker Postgres** task and `persist`, use a fixed name (e.g. `app`) — isolation is the per-session volume.
   - **Set `PUBLIC_HOST` from `${{ baguette.services.<name>.public_uri }}` in `session.env`** — required for allowed-host config in step 3 (Action Cable origins, etc.). Also set framework-specific variants if needed (e.g. `NEXT_PUBLIC_APP_URL`).
   - Set `session.init` for install-only steps (`init` runs before depends-on on first task start). Run migrations and seeds on a task with `depends-on: [postgres]` (or equivalent), not in `init`.
   - **Prefer `pnpm install` over `npm install` or `yarn install`** to save storage space via pnpm's global content-addressable package cache. If the project uses npm or yarn, add `pnpm = "latest"` to `.mise.toml` to make pnpm available, then use `pnpm install` in the init script.
   - Set `session.cleanup` only when needed (worktree files, shared external DBs). With **docker** `persist` volumes, skip DB drop — Baguette removes `baguette_session_<short_id>` on archive. `${{ baguette.tasks.* }}` in `session.env` is not resolved during cleanup.
   - Add `session.tasks` for running tests and other useful tasks. Use the hash format where each key is the task name. Always add a **`reset-db`** task that drops and recreates the session database (e.g. `run: rm -f .data/app.sqlite3 && pnpm run db:migrate` for SQLite, or `run: pnpm run db:reset` for Postgres). With docker Postgres, give `reset-db` **`depends-on: [postgres]`** and **`DATABASE_URL` in task `env`**, same as other DB tasks. Add `ports` only to **command** tasks that must listen on the host (e.g. dev server); docker service tasks do not use `ports`.

3. **Configure the `services` block**:
   - Identify how the dev server(s) are started (e.g., `vite`, `next dev`, `rails server`, `python manage.py runserver`, `expo start`)
   - If the start command uses a hardcoded port (e.g., `vite --port 3000`), update it to read from an env var instead (e.g., `vite --port $VITE_PORT`)
   - Update any config files that hardcode the port (e.g., `vite.config.js`, `next.config.js`) to read from `process.env.VITE_PORT` or equivalent
   - Define each preview process as a task in `session.tasks` with `ports`, then reference it under `services` with `task` and `expose`. Example: `tasks.dev-server: { run: "vite --port $VITE_PORT", ports: [VITE_PORT] }` and `services.app: { task: dev-server, expose: VITE_PORT }`. If multiple processes must all be up before the app works (e.g., a Vite frontend and a Rails API on one preview entry), list all their ports on that task — baguette waits until every listed port is listening.
   - Add **multiple** `services` entries only when each process needs its own public URL (e.g., Expo + API). Use `${{ baguette.services.<name>.public_uri }}` in `session.env` to wire URLs into the relevant processes.
   - **Bind to `127.0.0.1`**: configure the dev server to listen on `127.0.0.1` explicitly, not just `localhost`. When baguette runs in Docker, `localhost` may resolve to `::1` (IPv6) but the proxy connects over IPv4. Pass the appropriate flag for the framework:
     - Vite: `vite --host 127.0.0.1 --port $PORT`
     - Next.js: `next dev -H 127.0.0.1 --port $PORT`
     - Rails: `rails server -b 127.0.0.1 -p $PORT`
     - Django: `python manage.py runserver 127.0.0.1:$PORT`
   - **Allow the preview service URL as an allowed host**: the dev server will receive requests with the baguette public hostname, so configure it to accept that host. **Do not allow all hosts** (avoid `allowedHosts: 'all'`, `ALLOWED_HOSTS = ['*']`, `config.hosts.clear`, etc.). Instead, add `PUBLIC_HOST` from `${{ baguette.services.<name>.public_uri }}` in `session.env` and configure the dev server to read from it specifically:
     - Vite: `server: { allowedHosts: [new URL(process.env.PUBLIC_HOST).hostname] }` in `vite.config.js`
     - Next.js: `allowedDevOrigins: [process.env.PUBLIC_HOST]` in `next.config.js`
     - Rails: `config.hosts << URI.parse(ENV['PUBLIC_HOST']).host` in `config/environments/development.rb`
     - Django: `ALLOWED_HOSTS = [urlparse(os.environ['PUBLIC_HOST']).hostname]`
   - **WebSocket / real-time servers**: if the app uses WebSockets or server-sent events, configure their allowed origins the same way:
     - Rails Action Cable: add `config.action_cable.allowed_request_origins = [ENV['PUBLIC_HOST']]` in `config/environments/development.rb`
     - Socket.io (Node.js): `new Server(httpServer, { cors: { origin: process.env.PUBLIC_HOST } })`
     - Django Channels: covered by `ALLOWED_HOSTS` above when using ASGI

4. **Add Docker service tasks** in `session.tasks` when the project needs PostgreSQL, Redis, MySQL, or similar:
   - Use `type: docker` with a `container` block (`image` or `build`, optional `persist`, optional `healthcheck`) and `task.env` for container variables (e.g. `POSTGRES_PASSWORD`). With `build`, Baguette runs `docker build` from the session worktree before starting the container. Docker tasks join the `baguette_default` network and **must not** declare `ports:` — there is no dynamic host port for the database or cache.
   - Data in `persist` is stored on a per-session Docker volume `baguette_session_<short_id>` (removed when the session is archived).
   - Put **`DATABASE_URL` (and similar) in task `env`** on every command task that uses the service, with **`depends-on: [postgres]`** (or the docker task key). Point URLs at `${{ baguette.tasks.<task-key>.container_hostname }}` plus the **standard in-container port** the image listens on (e.g. `postgres://postgres:postgres@${{ baguette.tasks.postgres.container_hostname }}:5432/app` — always `5432`, not a Baguette-assigned port).
   - On the first task start, `session.init` runs **before** `depends-on` tasks (e.g. docker Postgres). Put migrations on a task that `depends-on` the database (with `DATABASE_URL` in that task's `env`).
   - **Redis example**: `type: docker`, `container: { image: redis:7, persist: ['/data'] }`, then `REDIS_URL` on task `env` with `depends-on: [redis]`: `redis://${{ baguette.tasks.redis.container_hostname }}:6379/0`.

5. **Configure per-session database isolation**:
   - **Docker Postgres (or similar) with `persist`**: Baguette mounts `baguette_session_<short_id>` — use a fixed database name (e.g. `app`); run migrations on tasks with `depends-on: [postgres]` and `DATABASE_URL` in task `env`.
   - **Shared external database**: use `short_id` in database names, create/drop in `init` / `cleanup`.
   - **SQLite or other files in the worktree**: isolation is usually the file path (e.g. `.data/app.sqlite3` per worktree).
   - For tests with docker Postgres, a separate fixed name (e.g. `app_test`) is enough; with shared Postgres, use `myapp_test_${{ baguette.session.short_id }}`.

6. **Write (or update) the `.baguette.yaml` file** at the project root with the configuration. Put Baguette-specific scripts under **`.baguette/scripts/`**. Only create or update **`.baguette/instructions.md`** if the user explicitly asks for persistent repo agent guidance — do not add it proactively during onboarding.

7. **Validate the setup**:
   - Attempt to run the `session.init` commands you wrote to verify they succeed
   - Fix any missing dependencies, missing env vars, or errors that come up

## How to proceed after reading this prompt

Use the technical sections above to create or update `.baguette.yaml` when appropriate.

**Decide** whether repository configuration is worth doing right now:

- A missing `.baguette.yaml` almost always warrants creating one.
- An outdated or incomplete file depends on scope — use judgment.

**If configuration should happen (or the user wants it):** use the **AskUserQuestion** tool with three options:

- **Configure in this session** — run through the onboarding steps from this prompt now, then **go back to the user’s original task** and finish it.
- **Start a new dedicated session** — call **`ConfigRepoStart`**, give the user the returned `sessionPath` link, then **resume the original task** in this session.
- **Skip for now** — continue the **original task** without configuring.

**CRITICAL:** Onboarding is supporting work. Whatever option the user picks, you must **return to and complete their original request** — do not leave the conversation stuck on setup alone unless they clearly asked to pause that work.

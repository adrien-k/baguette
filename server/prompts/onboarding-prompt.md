Check if `.baguette.yaml` already exists at the project root. If it does, review it and update it as needed. If it does not exist, create it from scratch.

## .baguette.yaml Format

```yaml
config:
  session:
    env:
      # Environment variables injected into every session.
      # Use ${{ baguette.secrets.SECRET_NAME }} to reference secrets stored in Settings > Secrets.
      # Use ${{ baguette.session.short_id }} to get a unique per-session identifier (useful for DB isolation).
      # Use ${{ baguette.session.public_uri }} to get the public URL of the single webserver (or the portal for multi-service).
      # Use ${{ baguette.services.<name>.public_uri }} to get the public URL of a specific named service (multi-service only).
      DATABASE_URL: 'postgres://user:${{ baguette.secrets.DB_PASSWORD }}@postgres:5432/app_${{ baguette.session.short_id }}'
      NEXT_PUBLIC_APP_URL: '${{ baguette.session.public_uri }}'
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      # Commands run when a session starts (after worktree creation).
      # Use this to install dependencies, create databases, run migrations, seeds, etc.
      # Prefer pnpm over npm/yarn to preserve disk storage via its global content-addressable cache.
      pnpm install
      pnpm run db:create
      pnpm run db:migrate
      pnpm run db:seed
    cleanup: |
      # Command run when a session is closed. Use to tear down per-session resources.
      pnpm run db:drop
    tasks:
      # Named tasks available in the session UI and MCP tools.
      # Each key is the task name (used as label).
      run-tests:
        run: pnpm test
      dev-server:
        run: pnpm dev --port $VITE_PORT --host 127.0.0.1
        # List of env var names that baguette will assign free ports to before launching.
        # The command must use these env vars instead of hardcoded ports.
        ports: [VITE_PORT, RAILS_PORT]
      e2e-tests:
        run: pnpm run e2e --base-url http://127.0.0.1:${{ baguette.tasks.dev-server.VITE_PORT }}
        # depends-on ensures the dependency task is running and its ports are listening.
        depends-on: [dev-server]
  # Single-service preview (most projects): reference one task.
  # Use `services` instead for multi-service setups (see below).
  # Optional: custom URL scheme for deep links (e.g. Expo exp://). Also supported per-service.
  preview:
    scheme: exp://
  webserver:
    # Reference a task from session.tasks (recommended). Mutually exclusive with command.
    task: dev-server
    # Which port env var is the one users access in the browser.
    expose: VITE_PORT
```

> **Legacy format**: You can also use an array-based `commands` format instead of `tasks`:
>
> ```yaml
> commands:
>   - label: Run tests
>     run: pnpm test
> ```

## webserver block fields

- **task**: reference a task key from `session.tasks`. The task's `run` command and `ports` are used to start the dev server.
- **expose**: which port env var is the one users reach in the browser. Only one port can be exposed.

## services block (multi-service preview)

Use `services` instead of `webserver` when the project has **multiple services that each need their own independent public URL** — the primary case is a mobile app (e.g., Expo/React Native) whose runtime directly calls an API backend. Each service gets its own subdomain `session-<id>-<name>.<domain>`. A portal page at `session-<id>.<domain>` lists all services with status and logs.

> **Do NOT use `services`** just because a project has a frontend and a backend: if the frontend proxies API calls via Vite's `proxy` config, Next.js rewrites, or similar, a single `webserver` entry is correct.

```yaml
config:
  session:
    env:
      DATABASE_URL: 'postgres://postgres:postgres@postgres:5432/app_${{ baguette.session.short_id }}'
      # Wire each service's public URL into the env so processes can reference them.
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
  # Use `services` (not `webserver`) for multi-service setups.
  # services and webserver are mutually exclusive.
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

- **run**: the shell command to execute
- **ports**: (optional) list of env var names that baguette will assign free ports to before launching
- **depends-on**: (optional) list of task keys that must be running and listening before this task starts. Dependency ports are available as `${{ baguette.tasks.<task-key>.<PORT_NAME> }}` in the `run` command.
- **env**: (optional) per-task environment variables, merged on top of `session.env` for this task only. Supports the same substitution syntax as `session.env`: `${{ baguette.secrets.X }}`, `${{ baguette.session.short_id }}`, `${{ baguette.session.public_uri }}`, and `${{ baguette.services.<name>.public_uri }}`. Use this to override or add env vars for a specific task without affecting others.

```yaml
tasks:
  dev-server:
    run: pnpm dev --port $VITE_PORT
    ports: [VITE_PORT]
    env:
      NODE_ENV: development
      API_KEY: '${{ baguette.secrets.DEV_API_KEY }}'
  run-tests:
    run: pnpm test
    env:
      NODE_ENV: test
      DATABASE_URL: 'postgres://user:${{ baguette.secrets.DB_PASSWORD }}@postgres:5432/app_${{ baguette.session.short_id }}_test'
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
   - Set `session.env` with all environment variables needed to run the app
   - Use `${{ baguette.session.short_id }}` in database names to isolate each session (e.g. `myapp_${{ baguette.session.short_id }}`)
   - **Always set `PUBLIC_HOST: "${{ baguette.session.public_uri }}"` in `session.env`** — this is required for host-restriction config in step 3 (allowed hosts, Action Cable origins, etc.) and for any app that needs to know its own public URL. Also set framework-specific variants if needed (e.g. `NEXT_PUBLIC_APP_URL: ${{ baguette.session.public_uri }}`)
   - Set `session.init` with commands to install deps, create per-session databases, run migrations, and run seeds (e.g., `rails db:seed`, `pnpm run db:seed`) if a seeding command exists in the project
   - **Prefer `pnpm install` over `npm install` or `yarn install`** to save storage space via pnpm's global content-addressable package cache. If the project uses npm or yarn, add `pnpm = "latest"` to `.mise.toml` to make pnpm available, then use `pnpm install` in the init script.
   - Set `session.cleanup` to tear down per-session databases
   - Add `session.tasks` for running tests and other useful tasks. Use the hash format where each key is the task name. Always add a **`reset-db`** task that drops and recreates the session database (e.g. `run: rm -f .data/app.sqlite3 && pnpm run db:migrate` for SQLite, or `run: dropdb ... && createdb ... && pnpm run db:migrate` for Postgres). This lets Claude quickly reset state during debugging. Add `ports` to any task that needs dynamically allocated ports.

3. **Configure the webserver or services block**:
   - Identify how the dev server(s) are started (e.g., `vite`, `next dev`, `rails server`, `python manage.py runserver`, `expo start`)
   - If the start command uses a hardcoded port (e.g., `vite --port 3000`), update it to read from an env var instead (e.g., `vite --port $VITE_PORT`)
   - Update any config files that hardcode the port (e.g., `vite.config.js`, `next.config.js`) to read from `process.env.VITE_PORT` or equivalent
   - **Single service (most projects)**: define the dev server as a task in `session.tasks` with `ports`, then reference it with `webserver.task`. Example: `tasks.dev-server: { run: "vite --port $VITE_PORT", ports: [VITE_PORT] }` and `webserver: { task: dev-server, expose: VITE_PORT }`. If multiple services must all be up before the app works (e.g., a Vite frontend and a Rails API), list all their ports on the task — baguette waits until every listed port is listening.
   - **Multi-service (e.g., Expo + API backend)**: use the `services` block instead of `webserver` — each service gets its own public subdomain. This is only needed when the services genuinely require independent public URLs (e.g., a mobile app that calls an API directly). Use `${{ baguette.services.<name>.public_uri }}` in `session.env` to wire each service's URL into the relevant processes.
   - **Bind to `127.0.0.1`**: configure the dev server to listen on `127.0.0.1` explicitly, not just `localhost`. When baguette runs in Docker, `localhost` may resolve to `::1` (IPv6) but the proxy connects over IPv4. Pass the appropriate flag for the framework:
     - Vite: `vite --host 127.0.0.1 --port $PORT`
     - Next.js: `next dev -H 127.0.0.1 --port $PORT`
     - Rails: `rails server -b 127.0.0.1 -p $PORT`
     - Django: `python manage.py runserver 127.0.0.1:$PORT`
   - **Allow the baguette public URI as an allowed host**: the dev server will receive requests with the baguette public hostname, so configure it to accept that host. **Do not allow all hosts** (avoid `allowedHosts: 'all'`, `ALLOWED_HOSTS = ['*']`, `config.hosts.clear`, etc.). Instead, add `PUBLIC_HOST: "${{ baguette.session.public_uri }}"` to `session.env` and configure the dev server to read from it specifically:
     - Vite: `server: { allowedHosts: [new URL(process.env.PUBLIC_HOST).hostname] }` in `vite.config.js`
     - Next.js: `allowedDevOrigins: [process.env.PUBLIC_HOST]` in `next.config.js`
     - Rails: `config.hosts << URI.parse(ENV['PUBLIC_HOST']).host` in `config/environments/development.rb`
     - Django: `ALLOWED_HOSTS = [urlparse(os.environ['PUBLIC_HOST']).hostname]`
   - **WebSocket / real-time servers**: if the app uses WebSockets or server-sent events, configure their allowed origins the same way:
     - Rails Action Cable: add `config.action_cable.allowed_request_origins = [ENV['PUBLIC_HOST']]` in `config/environments/development.rb`
     - Socket.io (Node.js): `new Server(httpServer, { cors: { origin: process.env.PUBLIC_HOST } })`
     - Django Channels: covered by `ALLOWED_HOSTS` above when using ASGI

4. **Check the global docker-compose file** at `{{DOCKER_COMPOSE_PATH}}`:
   - Read the file to see what services already exist (postgres, redis, etc.)
   - If the project needs services not yet defined, add them to the global docker-compose file. It there is already a service defined let's just use it. We can be lose on service versions, just ask the user if they are ok with it. (For example if we have a postgres:16 already available in compose but the project is on postgres v8)
   - Start any newly added services with `docker compose -f {{DOCKER_COMPOSE_PATH}} up -d <service>`
   - Update the corresponding connection URLs in `session.env` to reference the docker service host. You can use the docker compose service name as host (e.g. after adding or finding a "postgres" service on the docker compose file, add `DATABASE_URL: "postgres://user:pass@postgres/..."`)
   - **Never use `localhost` or `127.0.0.1` for docker-compose services**: baguette sessions run inside Docker, so `localhost` resolves to the session container itself — not the host and not other containers. Always use the docker-compose service name as the hostname (e.g. `postgres`, `redis`, `mysql`). Docker's internal DNS resolves these names correctly across containers. For example:
     - PostgreSQL: `DATABASE_URL: "postgres://user:pass@postgres:5432/myapp"`
     - Redis: `REDIS_URL: "redis://redis:6379/0"`
     - MySQL: `DATABASE_URL: "mysql2://user:pass@mysql:3306/myapp"`

5. **Configure per-session database isolation**:
   - Each session gets a unique `shortId`. Use it in database names so sessions don't interfere
   - The `init` script should create the session-specific database
   - The `cleanup` script should drop it
   - You may need to modify the app's database config to read from an environment variable instead of a hardcoded name
   - For tests, ensure they also use a session-specific database (e.g. `myapp_test_${{ baguette.session.short_id }}`).
   - This does not apply to databases on disk relative to the project root (ex: sqlite databases with relative paths).

6. **Write (or update) the .baguette.yaml file** at the project root with the configuration.

7. **Validate the setup**:
   - Attempt to run the `session.init` commands you wrote to verify they succeed
   - Fix any missing dependencies, missing env vars, or errors that come up

## How to proceed after reading this prompt

You fetched this text with **`baguette-op config-repo-prompt`**. Use the technical sections above to create or update `.baguette.yaml` when appropriate.

**Decide** whether repository configuration is worth doing right now:

- A missing `.baguette.yaml` almost always warrants creating one.
- An outdated or incomplete file depends on scope — use judgment.

**If configuration should happen (or the user wants it):** use the **AskUserQuestion** tool with three options:

- **Configure in this session** — run through the onboarding steps from this prompt now, then **go back to the user’s original task** and finish it.
- **Start a new dedicated session** — run `baguette-op config-repo-start`, give the user the returned `sessionPath` link, then **resume the original task** in this session.
- **Skip for now** — continue the **original task** without configuring.

**CRITICAL:** Onboarding is supporting work. Whatever option the user picks, you must **return to and complete their original request** — do not leave the conversation stuck on setup alone unless they clearly asked to pause that work.

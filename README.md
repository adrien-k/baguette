# Baguette 🥖

![Demo](docs/demo-optimized.gif)

## What is Baguette?

Baguette is a self-hosted orchestrator for AI coding agents that runs in the cloud, giving you AI-powered coding sessions with GitHub integration, isolated test environments, and the ability to review and merge changes — from any device, including your phone. It supports both [Claude Code](https://platform.claude.com/docs/en/agent-sdk/typescript) and [Cursor](https://cursor.com) as agent backends.

- **Runs in the cloud, accessible anywhere** -- Deploy to your own VPS or EC2 instance and develop from any device, including your phone.
- **Tests and dev servers for every session** -- Baguette configures the host to run databases, tests, and whatever else your project needs, isolated per session.
- **Review, merge, and ship without leaving the UI** -- Check your diffs and merge PRs right from Baguette. If you have CI/CD configured, merging deploys straight to production.

**What it isn't:**

- **An isolated environment to run agents** -- Baguette runs agents with full shell access on the host. The good news is you can run it on a dedicated machine with limited access.
- **A secured multi-tenant platform** -- This is primarily intended for a single user or a close group of builders who don't mind sharing the code (no filesystem isolation) they work on and the machine resources (CPU, memory, database servers, etc.).

## Features

- **GitHub sign-in (optional)** -- Sign in through your own GitHub App to create branches and PRs on your behalf. Baguette is scoped to the repositories you grant the App -- down to a single one. You can skip the App and use passkeys and/or a personal access token instead.
- **Claude & Cursor agents** -- Choose between Claude Code and Cursor as the agent backend when creating a session. Both support Start (agent) and Plan modes.
- **Session management** -- Spin up sessions from any branch of any repo. Each session gets its own git worktree.
- **Multi-session orchestration** -- Run several sessions in parallel from a global session: agents subscribe to child-session turn-end notifications and report progress as it happens ([read more](docs/sessions-and-agents.md)).
- **Live preview** -- Test your session's changes live in the browser. Each session gets a subdomain hooked to its development server, its own database, and the rest of its isolated stack ([read more](docs/session-management.md#web-server-preview)).
- **Automatic PR creation** -- After the first round of changes, a branch and PR are automatically created with an AI-generated title and description.
- **Task execution** -- Run arbitrary commands within a session's working directory. Tail logs, kill processes, and track running tasks per-session and globally.
- **Diff view** -- Browse the session's current git diff with per-file sections and inline/split toggle.
- **File attachments** -- Attach images and files to any chat message.
- **Cost tracking** -- Track session costs on session cards, with a daily chart and usage breakdown per repo (Claude and Cursor costs tracked separately).
- **Slack** -- Connect one or more Slack bots at the admin level and agents can post updates to a channel ([read more](docs/slack.md)).
- **Secrets** -- Inject global secrets into all sessions and tasks via Baguette config placeholders.
- **Session config (`.baguette.yaml`)** -- Define per-session env vars, init commands, tasks with port allocation and dependencies, and cleanup in your repo. See **[docs/project-configuration.md](docs/project-configuration.md)**.
- **User approval** -- The first visitor is the instance admin. Later GitHub users wait for approval on **Admin → Users**. Without a GitHub App, the admin invites additional users with a one-time link; they add a passkey when they open it.

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) 20+. No `.env` file is required for a first run.

```bash
npm install -g baguette-ai
baguette
```

The `baguette` command runs database migrations, then starts the server (default port **3000**). Open [http://www.127.0.0.1.traefik.me:3000](http://www.127.0.0.1.traefik.me:3000) (default public URL; matches WebAuthn and GitHub callback hosts), claim the instance as the first visitor (admin), and finish the wizard: create a GitHub App (manifest) or skip (passkey). Configure agents in **Settings → Agent** with your Anthropic and/or Cursor credentials.

For a real deployment, run with **`NODE_ENV=production`** and configure the public URL with either **`PUBLIC_HOST`** (full URL) or **`DOMAIN`** (apex hostname). `npm start` sets `NODE_ENV=production`; the global `baguette` CLI does not — export both vars yourself when deploying that way.

Persistent data (SQLite, encryption key, repo clones, worktrees) is stored under **`~/.baguette`** by default. On first boot, Baguette creates `encryption.key` there (mode `0600`) — back up that directory across restarts.

**Optional on the host:**

- [Claude Code](https://claude.ai/install.sh) for Claude agent sessions: `curl -fsSL https://claude.ai/install.sh | bash`
- [code-server](https://coder.com/docs/code-server/install) for the **VS Code** button on sessions

To set a public hostname, bootstrap password, custom data directory, or other server options, see **[Environment variables](#environment-variables)** (or export vars in your process manager / container platform — no `.env` file needed).

To work on Baguette itself (Vite dev server, tests, optional `.env`), see **[CONTRIBUTING.md — Development setup](CONTRIBUTING.md#development-setup)**.

### Configuring agents

Configure your agent(s) in **Settings → Agent**.

**Claude:** Enter a Console API key (`sk-ant-api…`) in **API key**, or a subscription token from `claude setup-token` (`sk-ant-oat…`) in **Auth token**. For an Anthropic-compatible gateway, set **API base URL** with the **Auth token** or **API key** your gateway expects. **Test connection** calls the gateway’s `/v1/models` API — it does not run Claude Code. Claude Code must be installed on the host for agent sessions.

**Cursor:** Enter your Cursor API key and optionally set a default model and variant. No additional CLI installation required.

### GitHub App (optional)

To sign in with GitHub and open PRs on your repos, create and install a GitHub App. Step-by-step permissions and callback URLs for **development** (git checkout) are in [CONTRIBUTING.md](CONTRIBUTING.md#setting-up-the-github-app). For **production**, set `PUBLIC_HOST` to your public URL (see [Environment variables](#environment-variables)) and use `{PUBLIC_HOST}/auth/github/callback` as the App callback and setup URL.

## Deploy

- **[Fly.io guide](docs/deployment/fly.io.md)** — Deploy in minutes with auto stop/start machines and pay-per-use billing. No server management required.
- **[Kamal guide (VPS)](docs/deployment/kamal.md)** — Deploy to any Ubuntu VPS (Hetzner, EC2, DigitalOcean, etc.) using [Kamal](https://kamal-deploy.org/). Includes a GitHub Actions workflow for manual deploys via workflow_dispatch.
- **[AWS EC2 + CloudFormation](docs/deployment/aws-ec2-kamal.md)** — Provision EC2, Route 53, and acme.sh for Kamal with stack outputs for GitHub Actions CI variables.

## Environment variables

Baguette reads configuration from the process environment. None are required for a local try on `localhost` (no `NODE_ENV`, or `NODE_ENV` other than `production`).

**Public URL (production):** set **either** `PUBLIC_HOST` **or** `DOMAIN`. With `NODE_ENV=production`, the server refuses to start if neither is set.

- **`PUBLIC_HOST`** — Full base URL where the application will be available, including scheme and optional port (e.g. `https://your-app.fly.dev`, `https://www.baguette.example.com`).
- **`DOMAIN`** — Apex hostname only (e.g. `baguette.example.com`). Baguette derives `PUBLIC_HOST` as `https://www.<DOMAIN>` in production.

| Variable             | Description                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | Set to `production` on real deployments (`npm start`, Docker, Kamal). With production, set `PUBLIC_HOST` or `DOMAIN` as above.                                                                  |
| `PUBLIC_HOST`        | Public base URL of the UI. **Production:** set this _or_ `DOMAIN`.                                                                                                                              |
| `DOMAIN`             | Apex hostname (e.g. `baguette.example.com`). **Production:** set this _or_ `PUBLIC_HOST`. Dev default when unset: `127.0.0.1.traefik.me`.                                                       |
| `DATA_DIR`           | Data directory for the SQLite DB, `encryption.key`, repo clones, and worktrees (default: `~/.baguette`). Relative paths resolve from the install directory.                                     |
| `PORT`               | Express listen port (default: `3000`). In development, also appended when deriving `PUBLIC_HOST` from `DOMAIN` (ignored when `PUBLIC_HOST` is set; omitted from derived production HTTPS URLs). |
| `BOOTSTRAP_PASSWORD` | Optional. One-time first-visitor gate on public hosts. Env-only; never written to disk.                                                                                                         |
| `TRUST_PROXY_HOPS`   | Reverse-proxy hops trusted for `X-Forwarded-For` (default: `1`). Set `0` when Baguette is exposed directly with no proxy.                                                                       |
| `TRUST_EDGE_COUNTRY` | Optional. Set `1` behind Cloudflare, CloudFront, or App Engine; default off (country from geoip on client IP).                                                                                  |

If `encryption.key` is missing under `DATA_DIR`, first boot generates one. Losing that file makes cookies and encrypted secrets unreadable — Baguette never regenerates over an existing file.

### What is IP detection used for?

Baguette records the client IP of each request and uses it for:

- **Rate limiting sign-in attempts** — failed bootstrap-password and passkey attempts are throttled per client IP.
- **Last sign-in visibility** — **Admin → Users** shows each account's last-used IP and country.
- **IP-public previews** — for previews used outside a browser (e.g. Expo Go), the IP that started the dev server can use the preview without signing in.

The IP is read from `X-Forwarded-For` right-to-left: every proxy in front of Baguette appends the address it saw, so only the rightmost `TRUST_PROXY_HOPS` entries cannot be forged by the client.

Defaults for `TRUST_PROXY_HOPS` and `TRUST_EDGE_COUNTRY` match the documented deployments ([Fly.io](docs/deployment/fly.io.md), [Kamal](docs/deployment/kamal.md), [AWS EC2](docs/deployment/aws-ec2-kamal.md)).

Repository contributors can copy [`.env.dev.example`](.env.dev.example) to `.env` for local overrides and live SDK test keys — see [CONTRIBUTING.md](CONTRIBUTING.md#development-setup).

## Tech Stack

- **Backend**: Express, Feathers.js, SQLite (via Knex), Socket.io
- **Frontend**: Vite, React, Tailwind CSS
- **AI**: `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`

## Configuring your project

Add a `.baguette.yaml` file so Baguette can run tests, dev servers, and other tasks across parallel sessions without database or port conflicts. The config defines per-session environment variables, initialization commands, named tasks with automatic port allocation, and a dev server preview.

See **[docs/project-configuration.md](docs/project-configuration.md)** for the full schema, task dependencies, and framework-specific examples.

## Session management

For details on the data directory layout, git worktree strategy, and web server preview, see **[docs/session-management.md](docs/session-management.md)**.

## Slack

Connect a Slack workspace under **Admin → Slack** to let agents post updates to a channel. See **[docs/slack.md](docs/slack.md)** for the app setup and required scopes. Plugin install stays in **Settings → Plugins** and can be done by any approved user.

## Security

For the trust model and secrets handling, see **[docs/security.md](docs/security.md)**.

## Status

Baguette is an early-stage project. Most of the codebase is AI-written and human-reviewed — it works, but expect rough edges. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

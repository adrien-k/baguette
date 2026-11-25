# Baguette 🥖

![Demo](docs/demo-optimized.gif)

## What is Baguette?

Baguette is a self-hosted orchestrator for AI coding agents that runs in the cloud, giving you AI-powered coding sessions with GitHub integration, isolated test environments, and the ability to review and merge changes — from any device, including your phone. It supports [Claude Code](https://platform.claude.com/docs/en/agent-sdk/typescript), [Cursor](https://cursor.com), [Pi](https://pi.dev) (OpenRouter, OpenCode Zen, ZAI, and many other LLM providers), and Antigravity (via the Agent Client Protocol).

- **Runs in the cloud, accessible anywhere** -- Deploy to your own VPS or EC2 instance and develop from any device, including your phone.
- **Tests and dev servers for every session** -- Baguette configures the host to run databases, tests, and whatever else your project needs, isolated per session.
- **Review, merge, and ship without leaving the UI** -- Check your diffs and merge PRs right from Baguette. If you have CI/CD configured, merging deploys straight to production.

**What it isn't:**

- **An isolated environment to run agents** -- Baguette runs agents with full shell access on the host. Run it on a dedicated non-sensitive machine or VM.
- **A secured multi-tenant platform** -- This is primarily intended for a single user or a close group of builders who don't mind sharing the code (no filesystem isolation) they work on and the machine resources (CPU, memory, database servers, etc.).

## Features

- **GitHub sign-in (optional)** -- Sign in through your own GitHub App to create branches and PRs on your behalf. Baguette is scoped to the repositories you grant the App -- down to a single one. You can skip the App and use passkeys and/or a personal access token instead.
- **Claude, Cursor, Pi & Antigravity agents** -- Choose Claude Code, Cursor, Pi, or Antigravity as the agent backend when creating a session. All support Start (agent) and Plan modes.
- **Session management** -- Spin up sessions from any branch of any repo. Each session gets its own git worktree.
- **Multi-session orchestration** -- Run several sessions in parallel from a global session: agents subscribe to child-session turn-end notifications and report progress as it happens ([read more](docs/sessions-and-agents.md)).
- **Live preview** -- Test your session's changes live in the browser. Each session gets a subdomain hooked to its development server, its own database, and the rest of its isolated stack ([read more](docs/session-management.md#web-server-preview)).
- **Automatic PR creation** -- After the first round of changes, a branch and PR are automatically created with an AI-generated title and description.
- **Task execution** -- Run arbitrary commands within a session's working directory. Tail logs, kill processes, and track running tasks per-session and globally.
- **Diff view** -- Browse the session's current git diff with per-file sections and inline/split toggle.
- **File attachments** -- Attach images and files to any chat message.
- **Cost tracking** -- Track session costs on session cards, with a daily chart and usage breakdown per repo (per agent backend).
- **Slack** -- Tag the Baguette app in a Slack channel and your personal Slack global session answers at once, starts sessions for the work and reports results and PR links back in the thread. Uses Socket Mode, so it works locally and behind a firewall ([read more](docs/slack.md)).
- **Secrets** -- Inject global secrets into all sessions and tasks via Baguette config placeholders.
- **Session config (`.baguette.yaml`)** -- Define per-session env vars, init commands, tasks with port allocation and dependencies, and cleanup in your repo. See **[docs/project-configuration.md](docs/project-configuration.md)**.
- **User approval** -- The first visitor is the instance admin. Later GitHub users wait for approval on **Admin → Users**. Without a GitHub App, the admin invites additional users with a one-time link; they add a passkey when they open it.

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) 22+.

```bash
npm install -g baguette-ai
baguette
```

The `baguette` command runs database migrations, then starts the server (default port **3000**). Open [http://www.127.0.0.1.traefik.me:3000](http://www.127.0.0.1.traefik.me:3000), claim the instance as the first visitor (admin), and finish the wizard: create a GitHub App (manifest) or skip (passkey). Configure agents in **Settings → Agent** (see [Configuring agents](#configuring-agents)).

For production, set **`NODE_ENV=production`** and configure the public URL with **`PUBLIC_HOST`** or **`DOMAIN`** — see [Environment variables](#environment-variables).

Persistent data (database, repo clones, worktrees) lives under **`~/.baguette`** by default. Back up that directory across restarts.

**Optional on the host:**

- [Claude Code](https://claude.ai/install.sh) for Claude agent sessions: `curl -fsSL https://claude.ai/install.sh | bash`
- Antigravity CLI (`agy`) for Antigravity agent sessions
- [code-server](https://coder.com/docs/code-server/install) for the **VS Code** button on sessions

To set a public hostname, bootstrap password, custom data directory, or other server options, see **[Environment variables](#environment-variables)**.

To work on Baguette itself (Vite dev server, tests, optional `.env`), see **[CONTRIBUTING.md — Development setup](CONTRIBUTING.md#development-setup)**.

### Configuring agents

Configure your agent(s) in **Settings → Agent**.

**Claude:** Enter a Console API key (`sk-ant-api…`) in **API key**, or a subscription token from `claude setup-token` (`sk-ant-oat…`) in **Auth token**. For an Anthropic-compatible gateway, set **API base URL** with the **Auth token** or **API key** your gateway expects. **Test connection** calls the gateway’s `/v1/models` API — it does not run Claude Code. Claude Code must be installed on the host for agent sessions.

**Cursor:** Enter your Cursor API key and optionally set a default model and variant. No additional CLI installation required.

**Pi:** Use Pi when you want models from providers other than Anthropic or Cursor — for example [OpenRouter](https://openrouter.ai/), [OpenCode Zen](https://opencode.ai/), [ZAI](https://z.ai/), Groq, or DeepSeek. Pi supports [many providers](https://pi.dev/docs/latest/providers); each maps to an API-key environment variable (e.g. `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `ZAI_API_KEY`). In **Settings → Agent**, add a configuration, choose **Pi** as the agent type, select the matching **API key env var**, paste your provider API key, and run **Test connection** to load models. Set a default model for new sessions. You can add multiple Pi configurations for different providers. No extra CLI installation is required on the host.

**Antigravity:** Runs the local `agy` CLI over the Agent Client Protocol (`agy acp`). Antigravity uses your local `agy` login by default — no API key is required, though you can optionally provide a Gemini API key or set `ANTIGRAVITY_BIN` in **Extra env**. Run **Test connection** to verify CLI availability, authentication, and available models.

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

Repository contributors can copy [`.env.example`](.env.example) to `.env` for local overrides and live SDK test keys — see [CONTRIBUTING.md](CONTRIBUTING.md#development-setup).

## Tech Stack

- **Backend**: Express, Feathers.js, SQLite (via Knex), Socket.io
- **Frontend**: Vite, React, Tailwind CSS
- **AI**: `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, `@earendil-works/pi-coding-agent`, `@agentclientprotocol/sdk`

## Configuring your project

Add a `.baguette.yaml` file so Baguette can run tests, dev servers, and other tasks across parallel sessions without database or port conflicts. The config defines per-session environment variables, initialization commands, named tasks with automatic port allocation, and a dev server preview.

The easiest way to get started is to open a Baguette session on the repository and ask it to **configure the repo for Baguette** — it can generate `.baguette.yaml` (and optional `.baguette/` helpers) from your codebase.

See **[docs/project-configuration.md](docs/project-configuration.md)** for the full schema, task dependencies, and framework-specific examples.

## Session management

For details on the data directory layout, git worktree strategy, and web server preview, see **[docs/session-management.md](docs/session-management.md)**.

## Slack

Tag the Baguette app in a Slack channel and a Slack global session (one global session per Slack thread, owned by the person who tagged it) answers right away. It never blocks on the work: it starts a session for the task, stays free for your next message, and reports progress, the PR link and the branch back in the thread when that session finishes. It reacts when tagged or addressed by name ("baguette …"), and in a thread it serves it follows the conversation without a tag. You have to be logged in to Baguette and have linked your Slack account; the global session only listens to you and the people you allow (in the session's Details tab) and ignores everyone else.

Baguette connects to Slack over [Socket Mode](https://api.slack.com/apis/socket-mode): it opens an outbound connection, so **no public URL, tunnel or open port is needed**. It works locally and behind a firewall.

### Setting up the Slack app

1. Create the app at <https://api.slack.com/apps> → **Create New App → From scratch**.
2. **Socket Mode** → enable it. Then **Basic Information → App-Level Tokens → Generate Token and Scopes**, add the `connections:write` scope, and copy the token (`xapp-…`).
3. **OAuth & Permissions** → add the **Bot Token Scopes** `app_mentions:read`, `users:read`, `files:read`, `chat:write`, `assistant:write`, `channels:read`, `groups:read`, `channels:history`, `groups:history`, then **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`) shown on that same page.
4. **Event Subscriptions** → switch **Enable Events** on. Under **Subscribe to bot events** (not "on behalf of users"), click **Add Bot User Event** and add **`app_mention`**, **`message.channels`**, **`message.groups`** and **`agent_session_stopped`**, then **Save Changes**. Without this Slack sends the bot nothing, and tagging it does nothing. No Request URL is needed in Socket Mode.
5. **Install App → Reinstall to Workspace** (Slack shows a banner after you change scopes or events), and copy the **Bot User OAuth Token** again if it changed.
   While the agent works, Slack shows its native animated status under the thread: "Baguette is cooking… 🥖". That needs `assistant:write` (step 3) and **Agents & AI Apps** switched on in the app's settings. With the `agent_session_stopped` event from step 4 it also gets a **Stop button**; clicking it stops the session like Stop in the Baguette UI (owner only).
   `users:read` is required for the session's Details tab and the bot to show real Slack usernames; without it they appear as raw ids like `U0EXAMPLE1` (the server logs `Slack user lookup failed … missing_scope`). If your app was installed before you added the scope, add it under **OAuth & Permissions** and reinstall — Slack only applies new scopes on reinstall.
6. Give Baguette the two tokens, either in **Settings → Integrations → Add Slack app** (name, app-level token, bot token — ignore the "Advanced" section), or in `.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_APP_TOKEN=xapp-…
   ```
7. In Slack, invite the bot to a channel (`/invite @<your app name>`) and tag it: `@<your app name> fix the flaky login test`. The first time, it replies privately with a link: log in to Baguette, confirm that the Slack account is yours, then tag it again. Without a default builder model (Settings → Agent) the Slack global session falls back to Haiku or Composer.

Say which repository you mean in plain words; it asks when it is unclear. You can limit an app to chosen repositories under **Settings → Integrations**.

The **Stop** button under the working status interrupts the Slack global session. Messages from Slack show up in the session chat as "Slack (name)". Attach json, txt, csv, svg, images… to a message and the agent gets them. Slack is visible to the whole company, so the bot never posts secrets or anything sensitive there — it points you to the session chat or pull request instead.

See **[docs/slack.md](docs/slack.md)** for scope details and the alternative public-URL setup.

## Security

For the trust model and secrets handling, see **[docs/security.md](docs/security.md)**.

## Status

Baguette is an early-stage project. Most of the codebase is AI-written and human-reviewed — it works, but expect rough edges. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

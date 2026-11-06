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

## Deploy

- **[Fly.io guide](docs/deployment/fly.io.md)** — Deploy in minutes with auto stop/start machines and pay-per-use billing. No server management required.
- **[Kamal guide (VPS)](docs/deployment/kamal.md)** — Deploy to any Ubuntu VPS (Hetzner, EC2, DigitalOcean, etc.) using [Kamal](https://kamal-deploy.org/). Includes a GitHub Actions workflow for manual deploys via workflow_dispatch.
- **[AWS EC2 + CloudFormation](docs/deployment/aws-ec2-kamal.md)** — Provision EC2, Route 53, and acme.sh for Kamal with stack outputs for GitHub Actions CI variables.

## Advanced settings

The env vars below only matter once Baguette is exposed beyond `localhost` — leave them at their defaults for local development.

### What is IP detection used for?

Baguette records the client IP of each request and uses it for three things:

- **Rate limiting sign-in attempts** — failed bootstrap-password and passkey attempts are throttled per client IP.
- **Last sign-in visibility** — **Admin → Users** shows each account's last-used IP and country.
- **IP-public previews** — for previews used outside a browser (e.g. Expo Go), the IP that started the dev server can use the preview without signing in.

The IP is read from `X-Forwarded-For` right-to-left: every proxy in front of Baguette appends the address it saw, so only the rightmost `TRUST_PROXY_HOPS` entries cannot be forged by the client. With the default of 1, a header value supplied directly by the browser is ignored.

| Variable             | Description                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY_HOPS`   | Reverse-proxy hops between the internet and Baguette trusted to set `X-Forwarded-For` (default: `1` — one proxy that appends the client address). Set `0` when Baguette is exposed directly with no proxy             |
| `TRUST_EDGE_COUNTRY` | Optional. Set `1` only when Baguette runs behind Cloudflare, CloudFront, or App Engine, which set the client-country header. Default off — Admin → Users last-used country comes from a geoip lookup of the client IP |

Both defaults match the documented deployments ([Fly.io](docs/deployment/fly.io.md), [Kamal](docs/deployment/kamal.md), [AWS EC2](docs/deployment/aws-ec2-kamal.md)); see those guides for the exact commands.

## Local development

### Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/) and/or a [Cursor](https://cursor.com) API key (configured in **Settings → Agent** after the first sign-in)
- Optional: a [GitHub App](https://github.com/settings/apps) — you can create one in the first-user wizard or later from **Admin → GitHub App**. See [Setting up the GitHub App](#setting-up-the-github-app).

### Setup

A single-node install needs **no required env vars**. Persist `DATA_DIR` (default `~/.baguette`) across restarts. Optional `BOOTSTRAP_PASSWORD` gates the first visitor on public hosts; it stays env-only and is never copied to disk.

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Optionally copy the example env file:

```bash
cp .env.example .env
```

| Variable             | Description                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOOTSTRAP_PASSWORD` | Optional. One-time first-visitor gate. Env-only; never written to disk. Set this on public hosts so a stranger cannot claim the instance.                     |
| `DATA_DIR`           | Data directory for the SQLite DB, `encryption.key`, repo clones, and worktrees (default: `~/.baguette`)                                                       |
| `PUBLIC_HOST`        | Public base URL of the server (e.g. `https://www.your-domain.com`) (defaults to `http://localhost:3000`, or `http://localhost:5173` if running `npm run dev`) |
| `PORT`               | Express server port (default: `3000`)                                                                                                                         |

If `encryption.key` is missing, first boot generates a key (file mode `0600`). Losing that file makes cookies and encrypted secrets unreadable — Baguette never regenerates over an existing file.

3. Run database migrations:

```bash
npm run migrate
```

4. Install Claude Code:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

5. _(Optional)_ Install [code-server](https://coder.com/docs/code-server/install) to enable the **VS Code** button on sessions:

```bash
curl -fsSL https://code-server.dev/install.sh | sh
```

6. Open the app, claim the instance as the first visitor (admin), and finish the wizard: create a GitHub App (manifest) or skip (passkey + optional PAT). Configure agents in **Settings → Agent**. Later users skip GitHub App and identity: they are invited by an admin (**Admin → Users**) and add a passkey from the invite link, or sign in with GitHub when an App is configured.

### Setting up the GitHub App

Baguette authenticates to GitHub exclusively through a GitHub App, so you choose which repositories it can touch when you install it — including just one.

1. Create a new GitHub App at [github.com/settings/apps](https://github.com/settings/apps).
2. Set **Callback URL** to `http://localhost:5173/auth/github/callback` (use your `PUBLIC_HOST` in production) and set **Setup URL** to the same value, so installing the App returns the user to Baguette.
3. Leave **Expire user authorization tokens** unchecked, and check **Request user authorization (OAuth) during installation** so signing in and installing are a single flow.
4. Grant these permissions:

   | Permission                 | Access         | Used for                                            |
   | -------------------------- | -------------- | --------------------------------------------------- |
   | Repository → Metadata      | Read-only      | Required by GitHub                                  |
   | Repository → Contents      | Read and write | Cloning, pushing, branches, tags                    |
   | Repository → Pull requests | Read and write | Creating, updating, reviewing, and merging PRs      |
   | Repository → Issues        | Read and write | PR comments, labels, and reactions                  |
   | Repository → Actions       | Read-only      | Workflow run status and logs                        |
   | Repository → Workflows     | Read and write | Pushing changes to files under `.github/workflows/` |
   | Account → Email addresses  | Read-only      | Associating your account and git commits with you   |

5. The first-user wizard (or **Admin → GitHub App**) can register the App via GitHub’s manifest flow and store credentials in the database.
6. Sign in, then install the App and pick the repositories Baguette may access. The repo picker lists exactly those repositories, and you can change the selection at any time from **Manage repository access** in the picker.

Notes:

- Installing on a repository owned by an organization may need approval from an org owner.
- Plugin marketplaces are third-party repositories outside your installation, so Baguette clones them without credentials. Public marketplaces work as usual; private ones are not supported.

### Configuring agents

Configure your agent(s) in **Settings** > **Agent**.

**Claude:** Enter a Console API key (`sk-ant-api…`) in **API key**, or a subscription token from `claude setup-token` (`sk-ant-oat…`) in **Auth token** (sent as `ANTHROPIC_AUTH_TOKEN`, Authorization: Bearer). To use an LLM gateway compatible with the Anthropic API, set **API base URL** (`ANTHROPIC_BASE_URL`) together with the **Auth token** or **API key** your gateway expects — the model list is then fetched from the gateway's `/v1/models` endpoint. **Test connection** calls the Anthropic-compatible API (`/v1/models`, with `/v1/messages` as a fallback) — it does not run Claude Code. Claude Code must still be installed (step 4 above) for agent sessions.

**Cursor:** Enter your Cursor API key and optionally set a default model and variant. No additional CLI installation required.

### Run

```bash
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies API/WebSocket requests to the Express server on port 3000.

For local sign-in without GitHub OAuth, use [`/auth/dev`](http://localhost:5173/auth/dev) when enabled.

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

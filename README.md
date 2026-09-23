# Baguette 🥖

![Demo](docs/demo-optimized.gif)

## What is Baguette?

Baguette is a self-hosted orchestrator for AI coding agents that runs in the cloud, giving you AI-powered coding sessions with GitHub integration, isolated test environments, and the ability to review and merge changes — from any device, including your phone. It supports both [Claude Code](https://platform.claude.com/docs/en/agent-sdk/typescript) and [Cursor](https://cursor.com) as agent backends.

- **Runs in the cloud, accessible anywhere** -- Deploy to your own VPS or EC2 instance and develop from any device, including your phone.
- **Tests and dev servers for every session** -- Baguette configures the host to run databases, tests, and whatever else your project needs, isolated per session.
- **Review, merge, and ship without leaving the UI** -- Check your diffs and merge PRs right from Baguette. If you have CI/CD configured, merging deploys straight to production.

**What it isn't:**

- **An isolated environment to run agents** -- Baguette runs agents with full shell access on the host. The good news is you can run it on a dedicated machine with limited access.
- **A multi-tenant platform** -- This is primarily intended for a single user or a close group of builders who don't mind sharing the code (no filesystem isolation) they work on and the machine resources (CPU, memory, database servers, etc.).

## Features

- **GitHub sign-in** -- Sign in through your own GitHub App to create branches and PRs on your behalf. Baguette is scoped to the repositories you grant the App -- down to a single one.
- **Claude & Cursor agents** -- Choose between Claude Code and Cursor as the agent backend when creating a session. Both support Start (agent) and Plan modes.
- **Session management** -- Spin up sessions from any branch of any repo. Each session gets its own git worktree.
- **Live preview** -- Test your session's changes live in the browser. Each session gets a subdomain hooked to its development server, its own database, and the rest of its isolated stack ([read more](docs/session-management.md#web-server-preview)).
- **Automatic PR creation** -- After the first round of changes, a branch and PR are automatically created with an AI-generated title and description.
- **Task execution** -- Run arbitrary commands within a session's working directory. Tail logs, kill processes, and track running tasks per-session and globally.
- **Diff view** -- Browse the session's current git diff with per-file sections and inline/split toggle.
- **File attachments** -- Attach images and files to any chat message.
- **Cost tracking** -- Track session costs on session cards, with a daily chart and usage breakdown per repo (Claude and Cursor costs tracked separately).
- **Slack** -- Connect one or more Slack bots at the admin level and agents can post updates to a channel ([read more](docs/slack.md)).
- **Secrets** -- Inject global secrets into all sessions and tasks via `.baguette.yaml` placeholders.
- **Session config (`.baguette.yaml`)** -- Define per-session env vars, init commands, tasks with port allocation and dependencies, and cleanup in your repo. See **[docs/project-configuration.md](docs/project-configuration.md)**.
- **User approval** -- First user is auto-approved; subsequent users require approval from an existing user.

## Deploy

- **[Fly.io guide](docs/deployment/fly.io.md)** — Deploy in minutes with auto stop/start machines and pay-per-use billing. No server management required.
- **[Kamal guide (VPS)](docs/deployment/kamal.md)** — Deploy to any Ubuntu VPS (Hetzner, EC2, DigitalOcean, etc.) using [Kamal](https://kamal-deploy.org/). Includes a GitHub Actions workflow for manual deploys via workflow_dispatch.
- **[AWS EC2 + CloudFormation](docs/deployment/aws-ec2-kamal.md)** — Provision EC2, Route 53, and acme.sh for Kamal with stack outputs for GitHub Actions CI variables.

## Local development

### Prerequisites

- Node.js 20+
- A [GitHub App](https://github.com/settings/apps) — Baguette only reaches the repositories you grant it at install time. See [Setting up the GitHub App](#setting-up-the-github-app).
- An [Anthropic API key](https://console.anthropic.com/) and/or a [Cursor](https://cursor.com) API key

### Setup

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable                    | Description                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_GITHUB_CLIENT_ID`     | GitHub App client ID                                                                                                                                          |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub App client secret                                                                                                                                      |
| `AUTH_GITHUB_APP_SLUG`      | GitHub App slug, i.e. the `<slug>` in `github.com/apps/<slug>`                                                                                                |
| `ENCRYPTION_KEY`            | At least 32 characters; used for cookie signing and for encrypting secrets                                                                                    |
| `PUBLIC_HOST`               | Public base URL of the server (e.g. `https://www.your-domain.com`) (defaults to `http://localhost:3000`, or `http://localhost:5173` if running `npm run dev`) |
| `PORT`                      | Express server port (default: `3000`)                                                                                                                         |
| `DATA_DIR`                  | Data directory for DB, repo clones, and worktrees (default: `~/.baguette`)                                                                                    |

3. Create the GitHub App and set its callback URL to `http://localhost:5173/auth/github/callback` — see [Setting up the GitHub App](#setting-up-the-github-app).

4. Run database migrations:

```bash
npm run migrate
```

5. Install Claude Code:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

6. _(Optional)_ Install [code-server](https://coder.com/docs/code-server/install) to enable the **VS Code** button on sessions:

```bash
curl -fsSL https://code-server.dev/install.sh | sh
```

7. Sign in with your GitHub account and configure your agent(s) in **Settings** > **Agent**.

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

5. Set `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET`, and `AUTH_GITHUB_APP_SLUG` in `.env` (the slug is the `<slug>` in `github.com/apps/<slug>`), then restart the server.
6. Sign in, then install the App and pick the repositories Baguette may access. The repo picker lists exactly those repositories, and you can change the selection at any time from **Manage repository access** in the picker.

Notes:

- Installing on a repository owned by an organization may need approval from an org owner.
- Plugin marketplaces are third-party repositories outside your installation, so Baguette clones them without credentials. Public marketplaces work as usual; private ones are not supported.

### Configuring agents

Configure your agent(s) in **Settings** > **Agent**.

**Claude:** Enter your Anthropic API key and optionally set a default model. Claude Code must be installed (step 5 above).

**Cursor:** Enter your Cursor API key and optionally set a default model and variant. No additional CLI installation required.

### Run

```bash
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies API/WebSocket requests to the Express server on port 3000.

### Dev preview fixture (optional)

After `pnpm run migrate`, seed a local git repo under `dev/preview-fixtures/demo-repo/` and two sessions for exercising preview UI (also runs automatically as part of `baguette:init` / session init):

```bash
pnpm run seed:dev-db
```

| Session                           | Branch           | Config                  |
| --------------------------------- | ---------------- | ----------------------- |
| **Dev preview: single webserver** | `preview-single` | One `webserver` task    |
| **Dev preview: multi-service**    | `preview-multi`  | Two `services` (portal) |

Sign in with [`/auth/dev`](http://localhost:5173/auth/dev) if you have not already. Re-running `seed:dev-db` is safe when both sessions already exist. Rebuild only the fixture git tree with `node dev/preview-fixtures/bootstrap-demo-repo.mjs`.

## Tech Stack

- **Backend**: Express, Feathers.js, SQLite (via Knex), Socket.io
- **Frontend**: Vite, React, Tailwind CSS
- **AI**: `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`

## Configuring your project

Add a `.baguette.yaml` file to your repository root so Baguette can run tests, dev servers, and other tasks across parallel sessions without database or port conflicts. The config defines per-session environment variables, initialization commands, named tasks with automatic port allocation, and a dev server preview.

See **[docs/project-configuration.md](docs/project-configuration.md)** for the full schema, task dependencies, and framework-specific examples.

## Session management

For details on the data directory layout, git worktree strategy, and web server preview, see **[docs/session-management.md](docs/session-management.md)**.

## Slack

Connect a Slack workspace under **Settings → Integrations** to let agents post updates to a channel. See **[docs/slack.md](docs/slack.md)** for the app setup and required scopes.

## Security

For the trust model and secrets handling, see **[docs/security.md](docs/security.md)**.

## Status

Baguette is an early-stage project. Most of the codebase is AI-written and human-reviewed — it works, but expect rough edges. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

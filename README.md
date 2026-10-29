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

- **GitHub sign-in** -- Sign in through your own GitHub App to create branches and PRs on your behalf. Baguette is scoped to the repositories you grant the App -- down to a single one.
- **Claude & Cursor agents** -- Choose between Claude Code and Cursor as the agent backend when creating a session. Both support Start (agent) and Plan modes.
- **Session management** -- Spin up sessions from any branch of any repo. Each session gets its own git worktree.
- **Live preview** -- Test your session's changes live in the browser. Each session gets a subdomain hooked to its development server, its own database, and the rest of its isolated stack ([read more](docs/session-management.md#web-server-preview)).
- **Automatic PR creation** -- After the first round of changes, a branch and PR are automatically created with an AI-generated title and description.
- **Task execution** -- Run arbitrary commands within a session's working directory. Tail logs, kill processes, and track running tasks per-session and globally.
- **Diff view** -- Browse the session's current git diff with per-file sections and inline/split toggle.
- **File attachments** -- Attach images and files to any chat message.
- **Cost tracking** -- Track session costs on session cards, with a daily chart and usage breakdown per repo (Claude and Cursor costs tracked separately).
- **Slack** -- Tag the Baguette app in a Slack channel to start a session (like Cursor) and get results and PR links back in the thread. Uses Socket Mode, so it works locally and behind a firewall ([read more](docs/slack.md)).
- **Secrets** -- Inject global secrets into all sessions and tasks via Baguette config placeholders.
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

| Variable                    | Description                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_GITHUB_CLIENT_ID`     | GitHub App client ID                                                                                                                                                                                      |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub App client secret                                                                                                                                                                                  |
| `AUTH_GITHUB_APP_SLUG`      | GitHub App slug, i.e. the `<slug>` in `github.com/apps/<slug>`                                                                                                                                            |
| `ENCRYPTION_KEY`            | At least 32 characters; used for cookie signing and for encrypting secrets                                                                                                                                |
| `PUBLIC_HOST`               | Public base URL of the server (e.g. `https://www.your-domain.com`) (defaults to `http://localhost:3000`, or `http://localhost:5173` if running `npm run dev`)                                             |
| `PORT`                      | Express server port (default: `3000`)                                                                                                                                                                     |
| `DATA_DIR`                  | Data directory for DB, repo clones, and worktrees (default: `~/.baguette`)                                                                                                                                |
| `TRUST_PROXY_HOPS`          | Reverse-proxy hops between the internet and Baguette trusted to set `X-Forwarded-For` (default: `1` — one proxy that appends the client address). Set `0` when Baguette is exposed directly with no proxy |

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

**Claude:** Enter a Console API key (`sk-ant-api…`) in **API key**, or a subscription token from `claude setup-token` (`sk-ant-oat…`) in **Auth token** (sent as `ANTHROPIC_AUTH_TOKEN`, Authorization: Bearer). To use an LLM gateway compatible with the Anthropic API, set **API base URL** (`ANTHROPIC_BASE_URL`) together with the **Auth token** or **API key** your gateway expects — the model list is then fetched from the gateway's `/v1/models` endpoint. **Test connection** calls the Anthropic-compatible API (`/v1/models`, with `/v1/messages` as a fallback) — it does not run Claude Code. Claude Code must still be installed (step 5 above) for agent sessions.

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

Tag the Baguette app in a Slack channel and it starts a session on your behalf, works on the task (branch, commits, PR), and posts the result back in the thread, ending with the PR link and branch. It reacts when tagged or addressed by name ("baguette …"), and in a thread it owns it follows the conversation without a tag, like a person would. To start a session you have to be logged in to Baguette and have linked your Slack account; anyone else gets a private "log in to Baguette" reply. Once a session is running in a thread, others in that thread can chip in with suggestions, and the owner stays in charge.

Baguette connects to Slack over [Socket Mode](https://api.slack.com/apis/socket-mode): it opens an outbound connection, so **no public URL, tunnel or open port is needed**. It works locally and behind a firewall.

### Setting up the Slack app

1. Create the app at <https://api.slack.com/apps> → **Create New App → From scratch**.
2. **Socket Mode** → enable it. Then **Basic Information → App-Level Tokens → Generate Token and Scopes**, add the `connections:write` scope, and copy the token (`xapp-…`).
3. **OAuth & Permissions** → add the **Bot Token Scopes** `app_mentions:read`, `users:read`, `files:read`, `chat:write`, `assistant:write`, `channels:read`, `groups:read`, `channels:history`, `groups:history`, then **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`) shown on that same page.
4. **Event Subscriptions** → switch **Enable Events** on. Under **Subscribe to bot events** (not "on behalf of users"), click **Add Bot User Event** and add **`app_mention`**, **`message.channels`**, **`message.groups`** and **`agent_session_stopped`**, then **Save Changes**. Without this Slack sends the bot nothing, and tagging it does nothing. No Request URL is needed in Socket Mode.
5. **Interactivity & Shortcuts** → switch **Interactivity** on (no URL needed in Socket Mode). This makes the session picker buttons work.
6. **Install App → Reinstall to Workspace** (Slack shows a banner after you change scopes or events), and copy the **Bot User OAuth Token** again if it changed.
   While the agent works, Slack shows its native animated status under the thread: "Baguette is cooking… 🥖". That needs `assistant:write` (step 3) and **Agents & AI Apps** switched on in the app's settings. With the `agent_session_stopped` event from step 4 it also gets a **Stop button**; clicking it stops the session like Stop in the Baguette UI (owner only). If Slack refuses the native status, Baguette posts and edits a "🥖 Baguette is cooking…" message instead; typing "stop" works either way.
   `users:read` is required for the session's Details tab and the bot to show real Slack usernames; without it they appear as raw ids like `U0CCTKMSWF6` (the server logs `Slack user lookup failed … missing_scope`). If your app was installed before you added the scope, add it under **OAuth & Permissions** and reinstall — Slack only applies new scopes on reinstall.
7. Give Baguette the two tokens, either in **Settings → Integrations → Add Slack app** (name, app-level token, bot token — ignore the "Advanced" section), or in `.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_APP_TOKEN=xapp-…
   ```
8. In Slack, invite the bot to a channel (`/invite @<your app name>`) and tag it: `@<your app name> fix the flaky login test`. The first time, it replies privately with a link: log in to Baguette, confirm that the Slack account is yours, then tag it again.

Add `repo=owner/name` (and optionally `branch=name`) to pick the repo; otherwise it uses your only repo, or the one from your latest session. Tag the bot again in the thread to give the same session more instructions.

Say "stop" and the bot interrupts the work at once. Messages from Slack show up in the session chat as "Slack (name)". Attach json, txt, csv, svg, images… to a message and the agent gets them. Slack is visible to the whole company, so the bot never posts secrets or anything sensitive there — it points you to the session chat or pull request instead.

See **[docs/slack.md](docs/slack.md)** for scope details and the alternative public-URL setup.

## Security

For the trust model and secrets handling, see **[docs/security.md](docs/security.md)**.

## Status

Baguette is an early-stage project. Most of the codebase is AI-written and human-reviewed — it works, but expect rough edges. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

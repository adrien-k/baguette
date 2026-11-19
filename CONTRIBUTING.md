# Contributing

Thanks for your interest in Baguette!

## Early stage project

Baguette is in early development. Most of the codebase is AI-written and human-reviewed — it works, but expect rough edges, missing abstractions, and areas that need polish. Contributions are welcome, but please keep this context in mind: we prioritize correctness and simplicity over clever engineering.

## How to contribute

- **Bug reports** — Open an issue with steps to reproduce and what you expected to happen.
- **Feature requests** — Open an issue describing the use case before writing code. This avoids wasted effort on things that don't fit the project's direction.
- **Pull requests** — Keep PRs small and focused. One thing per PR. If you're making a larger change, open an issue first to discuss the approach.

## Development setup

Run Baguette from a git checkout when you are changing the server, client, or tests. End users typically install [`baguette-ai`](README.md#quick-start) from npm instead.

### Prerequisites

- **Node.js 20+** — matches `package.json` `engines`. Enough for the client, tests, migrations, and for running the **compiled** backend (`npm run build:server`, then `npm start` or `scripts/start-server.mjs`).
- **Node.js 22.6+** — required to run the backend from **source** without `build:server`, because agent SDK code under `server/` and `shared/` is TypeScript loaded via `.ts` import specifiers. Node must run with [**type stripping**](https://nodejs.org/api/typescript.html) enabled (`--experimental-strip-types`). `npm run dev` passes that flag via `dev:server`; for ad-hoc `node server/index.js`, use the same flag or set `NODE_OPTIONS=--experimental-strip-types`. On Node 20.x–22.5.x, use the compiled backend instead of raw source.
- An [Anthropic API key](https://console.anthropic.com/) and/or a [Cursor](https://cursor.com) API key (configured in **Settings → Agent** after the first sign-in)
- Optional: a [GitHub App](https://github.com/settings/apps) — create one in the first-user wizard or later from **Admin → GitHub App** (see [GitHub App setup](#setting-up-the-github-app) below)

### Run from the repository

```bash
git clone <repository-url>
cd baguette
npm install
cp .env.dev.example .env   # optional: SDK test keys, DATA_DIR, DOMAIN overrides
npm run migrate
npm run dev
```

With the default dev `DOMAIN` (see [Environment variables](README.md#environment-variables)), open the UI at `http://www.127.0.0.1.traefik.me:5173`. Vite proxies API and WebSocket traffic to Express on port `3000`. Override the public URL with either `PUBLIC_HOST` or `DOMAIN` in `.env` if needed.

For local sign-in without GitHub OAuth, use `/auth/dev` on your dev UI origin when enabled.

Install [Claude Code](https://claude.ai/install.sh) for agent sessions (`curl -fsSL https://claude.ai/install.sh | bash`). Optionally install [code-server](https://coder.com/docs/code-server/install) for the **VS Code** button on sessions.

### Setting up the GitHub App

Baguette authenticates to GitHub through a GitHub App, so you choose which repositories it can access when you install it.

1. Create a new GitHub App at [github.com/settings/apps](https://github.com/settings/apps).
2. Set **Callback URL** and **Setup URL** to `{PUBLIC_HOST}/auth/github/callback` (default dev URL: `http://www.127.0.0.1.traefik.me:5173/auth/github/callback`).
3. Leave **Expire user authorization tokens** unchecked, and check **Request user authorization (OAuth) during installation**.
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

5. Use the first-user wizard or **Admin → GitHub App** to register the App via GitHub’s manifest flow.
6. Sign in, install the App, and pick repositories. Change access anytime from **Manage repository access** in the repo picker.

### Live agent-SDK integration tests

Optional **live agent-SDK tests** (`*.live.test.js`) call a real model and skip unless set. Copy the `SDK_TESTS_*` block from `.env.dev.example` (Claude / Cursor / Pi keys + model; `SDK_TESTS_MOCK=1` for the mock SDK). Do not set them in CI unless you intend to pay for those calls. The `agents-integration-test` Baguette task in `.baguette.yaml` runs Pi, Claude, and Cursor live tests on cheap OpenCode Go / Cursor models using Baguette secrets.

## Code style

- No framework, no unnecessary abstraction. Keep it simple.
- Run the linter before submitting: `npm run lint` (or `npm run lint:ci` to match CI, including unused-export checks)
- A Husky pre-commit hook runs Prettier on staged files (installed automatically by `npm install`). Skip it with `git commit --no-verify` if needed.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

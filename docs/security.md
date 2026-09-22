# Security

## Trust model

Baguette wraps Claude Code, and inherits its security model: Claude runs as a coding agent with shell access inside the session's worktree. It can read files and run shell commands, subject to the configured permission mode (default, accept edits, bypass, plan) and the allowed commands list. The interactive tool-approval flow in the UI provides additional control.

Because of this, **treat Baguette like any other server that runs untrusted code** — the risk surface is similar to a CI runner or a self-hosted code sandbox.

## Secrets and tokens

- **Do not put sensitive secrets into `.baguette.yaml` `session.env`**. Those values end up in the Claude agent's environment, where any shell tool call can potentially read them (e.g. `env`, `printenv`, shell scripts in the repo). Use them only for secrets that are genuinely required to run the application under test.
- Use **access tokens with the minimum required privileges**: the Anthropic API key should belong to a dedicated workspace or project with spending limits set.
- **Grant the GitHub App only the repositories it needs.** GitHub access is always App-based, and an App is limited to the repositories selected when it is installed — so a compromised Baguette instance cannot touch anything you did not grant it. Pick repositories individually rather than "All repositories". See [Setting up the GitHub App](../README.md#setting-up-the-github-app).
- **The Anthropic API key is not exposed to Claude's shell environment.** It is held exclusively by the Baguette server and never injected into the session's shell.
- **The GitHub token is not exposed to Claude's shell environment.** All authenticated git and GitHub API calls are proxied through the Baguette MCP server. Claude can commit and push changes, but cannot read the underlying token or perform GitHub operations directly.
- **Tasks spawned by Baguette (`.baguette.yaml` init/cleanup/commands) are isolated from the Baguette server's own environment.** They do not inherit the server's process environment — internal credentials such as the encryption key, GitHub token, and Anthropic API key are never passed to spawned processes, whether triggered by the server or by the agent via the MCP server.

## Development and test dependencies

- Ideally, your application's dependencies (databases, caches, queues) run as **Docker containers on the same machine**, managed via a shared `docker-compose.yml`. This keeps external credentials out of `.baguette.yaml` entirely — services are reachable on `localhost` with no authentication, or with static credentials that have no real-world impact.
- See the `session.init` / `session.cleanup` pattern in [session-management.md](session-management.md) for per-session database isolation.

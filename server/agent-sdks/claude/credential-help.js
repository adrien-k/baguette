/** Settings credential help (markdown) for Claude API key vs subscription auth token. */
export const CLAUDE_CREDENTIAL_HELP_BANNER = {
  markdown: `**API key** — Billed through the [Anthropic Console](https://console.anthropic.com/settings/keys) (\`sk-ant-api…\`). Set **Credential type** to **API key**.

**Auth token** — Use a Claude **Pro, Max, or Team subscription** instead of API billing (\`sk-ant-oat…\`). Set **Credential type** to **Auth token**, then paste a token from:

\`\`\`
claude setup-token
\`\`\``,
};

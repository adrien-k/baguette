/**
 * Last line of defence for what the bot says in Slack, which everyone in the company can read.
 * The agent is told never to post secrets; this catches the obvious ones if it does anyway, and
 * the message is replaced by a pointer to the session (or PR), where only Baguette users look.
 */

/** Patterns for credentials and sensitive material. Deliberately broad: a false alarm is cheap. */
const SECRET_PATTERNS = [
  ['Slack token', /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/],
  ['Slack app token', /\bxapp-\d-[A-Za-z0-9-]{10,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['API key', /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
  ['credentials in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
  [
    'secret assignment',
    /\b[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?[^\s"',;]{8,}/i,
  ],
];

/** What looks like a secret in `text` (its kind), or null. */
export function findSecret(text) {
  const value = String(text ?? '');
  for (const [kind, pattern] of SECRET_PATTERNS) {
    if (pattern.test(value)) return kind;
  }
  return null;
}

const SHARED_REASON =
  'it looks like it may contain something sensitive, and everyone in the company can read Slack';

/** Markdown that replaces a reply which looked sensitive. */
export function sensitiveReplacement({ sessionUrl, prUrl }) {
  const where = prUrl
    ? `You can read it in the session chat: ${sessionUrl}\nor in the pull request: ${prUrl}`
    : `You can read it in the session chat: ${sessionUrl}`;
  return `🔒 I can't share that here — ${SHARED_REASON}.\n${where}`;
}

/** The error a Slack tool returns to the agent when its message looks sensitive. */
export function sensitiveToolError({ kind, sessionUrl }) {
  return (
    `Blocked: the message looks like it contains a secret (${kind}). Slack is visible to everyone ` +
    'in the company, so nothing sensitive may be posted there — not even if the user asks. Tell ' +
    `them you can't share it in Slack and that they can read it in the session chat: ${sessionUrl}`
  );
}

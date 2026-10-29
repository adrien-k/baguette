/** Pure text helpers for Slack messages. */

const SLACK_REPLY_MAX_CHARS = 3500;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive match (so "pi" doesn't match "pipeline"). */
export function mentionsWord(text, word) {
  const w = String(word ?? '').trim();
  if (!w) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(w)}([^a-z0-9]|$)`, 'i').test(text);
}

/** Removes the `<@BOTID>` mention(s) from a message. */
export function stripBotMention(text, botUserId) {
  return String(text ?? '')
    .replace(new RegExp(`<@${botUserId}(\\|[^>]*)?>`, 'g'), '')
    .trim();
}

/** Pulls `repo=owner/name` and `branch=name` options (optionally in brackets) out of a message. */
export function parseSlackOptions(text) {
  const options = {};
  const prompt = String(text ?? '')
    .replace(/\[?\b(repo|branch)=([^\s\]]+)\]?/gi, (_match, key, value) => {
      options[key.toLowerCase()] = value.replace(/^<|>$/g, '');
      return '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { prompt, repo: options.repo ?? null, branch: options.branch ?? null };
}

/** Text of an assistant message row (`message_json`), or '' for tool-only or invalid rows. */
export function extractAssistantText(messageJson) {
  let parsed;
  try {
    parsed = JSON.parse(messageJson);
  } catch {
    return '';
  }
  // Stored rows use `blocks`; SDK-shaped payloads use `message.content`.
  const content = parsed?.blocks ?? parsed?.message?.content ?? parsed?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Best-effort GitHub-flavoured markdown → Slack mrkdwn, trimmed to a Slack-friendly length. */
export function toSlackMrkdwn(markdown) {
  let text = String(markdown ?? '')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<$2|$1>');
  if (text.length > SLACK_REPLY_MAX_CHARS) {
    text = `${text.slice(0, SLACK_REPLY_MAX_CHARS).trimEnd()}…\n_(truncated — full reply in Baguette)_`;
  }
  return text;
}

/** Slack message links in `text` (as `<url|label>` or bare), at most `max`, without duplicates. */
export function slackLinksIn(text, max = 3) {
  const urls = String(text ?? '').match(
    /https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d{16}[^\s>|)]*/gi
  );
  return [...new Set(urls ?? [])].slice(0, max);
}

const STOP_WORDS = new Set(['stop', 'cancel', 'abort', 'halt', 'interrupt']);
const STOP_FILLER = new Set(
  'please pls immediately now right away asap it this that all everything work working task the session agent and baguette thanks'.split(
    ' '
  )
);

/**
 * "stop", "stop now", "please cancel the work immediately" — a short message that is only a stop
 * request. "stop using var" is not one: anything else in the message makes it an ordinary request.
 */
export function isStopRequest(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (!words.length || words.length > 6) return false;
  return (
    words.some((w) => STOP_WORDS.has(w)) &&
    words.every((w) => STOP_WORDS.has(w) || STOP_FILLER.has(w))
  );
}

const TITLE_MAX_CHARS = 70;
const BRANCH_MAX_CHARS = 40;

/** A session title from the request: its first line, tidied and cut at a word. */
export function slackSessionTitle(prompt) {
  const firstLine =
    String(prompt ?? '')
      .split('\n')
      .map((line) =>
        line
          .replace(/[*_`>#]+/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .find(Boolean) ?? '';
  if (!firstLine) return null;
  const title = firstLine.charAt(0).toUpperCase() + firstLine.slice(1);
  if (title.length <= TITLE_MAX_CHARS) return title;
  const cut = title.slice(0, TITLE_MAX_CHARS - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

/** A git branch name from the request ("fix-the-flaky-login-test"), or null if nothing usable. */
export function slackBranchName(prompt) {
  const slug = String(prompt ?? '')
    .split('\n')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length < 3) return null;
  if (slug.length <= BRANCH_MAX_CHARS) return slug;
  const cut = slug.slice(0, BRANCH_MAX_CHARS);
  const endsAtWord = slug[BRANCH_MAX_CHARS] === '-';
  if (endsAtWord || !cut.includes('-')) return cut;
  return cut.slice(0, cut.lastIndexOf('-'));
}

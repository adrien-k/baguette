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

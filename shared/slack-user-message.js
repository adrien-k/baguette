/**
 * User messages that arrive from Slack. The agent receives the full text (the person's words plus
 * the Slack context); the chat shows who wrote it — "Slack (Jan)" instead of "You" — and what
 * they actually wrote.
 */

/** Extra fields for a user turn's `message_json` that mark it as coming from Slack. */
export function slackMessageMeta({ userId, userName, text, suggestion = false, untagged = false }) {
  return {
    source: 'slack',
    slack: {
      user_id: userId,
      user_name: userName ?? null,
      text: String(text ?? ''),
      suggestion: Boolean(suggestion),
      untagged: Boolean(untagged),
    },
  };
}

export function isSlackUserMessage(parsed) {
  return parsed?.type === 'user' && parsed.source === 'slack' && Boolean(parsed.slack);
}

/** What the chat shows for a Slack user message, or null when it is not one. */
export function describeSlackUserMessage(parsed) {
  if (!isSlackUserMessage(parsed)) return null;
  const { user_id: userId, user_name: userName, text, suggestion, untagged } = parsed.slack;
  return {
    label: `Slack (${userName || userId || 'unknown'})`,
    text: text ?? '',
    suggestion: Boolean(suggestion),
    untagged: Boolean(untagged),
  };
}

import { isBaguetteUserMessage, isHumanUserMessage } from './turn-model.js';

/**
 * Whether a new message row should bump `last_activity_at`.
 * Counts user turns, agent assistant output, and Claude `result` (turn end) — not tool results or system noise.
 */
export function messageCountsAsSessionActivity(row) {
  const type = row?.type;
  if (type === 'result' || type === 'assistant') return true;
  if (type !== 'user') return false;
  let parsed;
  try {
    parsed = JSON.parse(row.message_json || '{}');
  } catch {
    return false;
  }
  return isHumanUserMessage(parsed) || isBaguetteUserMessage(parsed);
}

import { isHumanUserMessage } from './turn-model.js';

/** Stable dock/pinning id for a typed tool_call view. */
export function toolCallViewId(msg) {
  return msg.call_id ?? `tool-${msg.id}`;
}

/** Whether a human user message appears after `messageIndex` in the thread. */
export function hasHumanUserReplyAfter(messages, messageIndex) {
  if (!Array.isArray(messages) || messageIndex == null || messageIndex < 0) return false;
  for (let i = messageIndex + 1; i < messages.length; i++) {
    if (isHumanUserMessage(messages[i])) return true;
  }
  return false;
}

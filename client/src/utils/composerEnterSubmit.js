import { isMobile } from './isMobile.js';

/** Desktop composer: Enter submits; Shift+Enter inserts a newline. Mobile: Enter always newline. */
export function isComposerEnterSubmitKey(e) {
  return !isMobile() && e.key === 'Enter' && !e.shiftKey;
}

/**
 * Textarea onKeyDown helper for chat-style composers.
 * @param {boolean} options.canSubmit — when false, Enter is still swallowed on desktop but onSubmit is not called
 */
export function handleComposerEnterKeyDown(e, { disabled = false, canSubmit, onSubmit }) {
  if (disabled) return;
  if (!isComposerEnterSubmitKey(e)) return;
  e.preventDefault();
  if (!canSubmit) return;
  onSubmit(e);
}

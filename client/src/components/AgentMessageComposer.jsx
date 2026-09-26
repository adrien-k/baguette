import SessionModelSelect from './SessionModelSelect.jsx';
import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import { CHAT_COLUMN_CLASS } from './ChatMessagesViewport.jsx';
import Tooltip from './Tooltip.jsx';
import { isMobile } from '../utils/isMobile.js';

/** Shared height/layout with Send so toolbar actions (e.g. Stop, attach) align. */
export const COMPOSER_ACTION_BUTTON_LAYOUT =
  'inline-flex items-center justify-center shrink-0 h-8 text-sm font-medium';

const SEND_BUTTON_BASE = `${COMPOSER_ACTION_BUTTON_LAYOUT} bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 border border-transparent px-4 sm:px-5 transition-colors disabled:cursor-not-allowed`;

/**
 * Chat-style message box: auto-growing textarea, model + variant row, Send.
 * Optional toolbar/send slots cover session-chat extras (attach, stop, schedule).
 */
export default function AgentMessageComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled = false,
  sending = false,
  session,
  models,
  cursorFast,
  cursorEffort,
  onModelChange,
  formClassName = 'relative z-[2] shrink-0 bg-zinc-950 pb-3 sm:pb-4 pt-1',
  skipColumn = false,
  textareaId,
  canSend: canSendProp,
  submitDisabled = false,
  submitLabel = 'Send',
  submitTooltip,
  toolbarExtra,
  sendAddon,
}) {
  const handleChange = (e) => {
    onChange(e.target.value);
  };

  const hasDraft = canSendProp ?? Boolean(value.trim());
  const canSubmit = hasDraft && !disabled && !sending && !submitDisabled;

  const handleKeyDown = (e) => {
    if (disabled || sending || submitDisabled) return;
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!hasDraft) return;
      onSubmit(e);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(e);
  };

  const sendButton = (
    <button
      type="submit"
      disabled={!canSubmit}
      className={`${SEND_BUTTON_BASE} ${
        sendAddon
          ? 'rounded-l-lg border-r border-amber-600/40 disabled:border-r-zinc-600'
          : 'rounded-lg'
      }`}
    >
      {sending ? '...' : submitLabel}
    </button>
  );

  const box = (
    <div
      className={`w-full rounded-lg border border-zinc-700 bg-zinc-800 overflow-visible ${
        disabled ? 'opacity-60' : 'focus-within:ring-2 focus-within:ring-amber-500/50'
      }`}
    >
      <AutoGrowTextarea
        id={textareaId}
        rows={1}
        maxHeightPx={160}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || sending}
        className="block w-full bg-transparent px-2 sm:px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed resize-none rounded-t-lg"
      />
      <div className="relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 pb-1.5 pt-0.5 rounded-b-lg overflow-visible">
        <SessionModelSelect
          session={session}
          models={models}
          cursorFast={cursorFast}
          cursorEffort={cursorEffort}
          onModelChange={onModelChange}
          disabled={disabled || sending}
        />
        <div className="flex-1 min-w-0" />
        {toolbarExtra}
        <div className="flex shrink-0 items-center">
          {submitTooltip ? (
            <Tooltip content={submitTooltip} wrap placement="top-end">
              {sendButton}
            </Tooltip>
          ) : (
            sendButton
          )}
          {sendAddon}
        </div>
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className={formClassName}>
      {skipColumn ? box : <div className={CHAT_COLUMN_CLASS}>{box}</div>}
    </form>
  );
}

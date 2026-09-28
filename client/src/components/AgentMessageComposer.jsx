import SessionModelSelect from './SessionModelSelect.jsx';
import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import { CHAT_COLUMN_CLASS } from './ChatMessagesViewport.jsx';
import Tooltip from './Tooltip.jsx';
import { isMobile } from '../utils/isMobile.js';

/** Shared height/layout with Send so toolbar actions (e.g. Stop, attach) align. */
export const COMPOSER_ACTION_BUTTON_LAYOUT =
  'inline-flex items-center justify-center shrink-0 h-8 text-sm font-medium';

/** Amber fill shared by Send/Start and its caret; use inside `COMPOSER_SPLIT_GROUP_CLASS`. */
export const COMPOSER_SPLIT_AMBER_CLASS =
  'bg-amber-500 hover:enabled:bg-amber-400 group-hover/split:enabled:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 transition-colors';

export const COMPOSER_SPLIT_GROUP_CLASS = 'group/split inline-flex items-stretch shrink-0';

const SEND_BUTTON_BASE = `${COMPOSER_ACTION_BUTTON_LAYOUT} bg-amber-500 hover:enabled:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 border border-transparent transition-colors disabled:cursor-not-allowed`;

const SEND_BUTTON_SPLIT = `${COMPOSER_ACTION_BUTTON_LAYOUT} ${COMPOSER_SPLIT_AMBER_CLASS} border border-transparent border-r border-amber-600/40 group-hover/split:enabled:border-amber-500/50 disabled:border-r-zinc-600 disabled:cursor-not-allowed`;

/** Tighter horizontal padding on small viewports; roomier from md up. */
const SUBMIT_BUTTON_PADDING = 'px-2.5 sm:px-3 md:px-4';

const TEXTAREA_CLASS =
  'block w-full bg-transparent px-2 sm:px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-t-lg';

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
  cursorModelPrefs,
  onCursorModelPrefChange,
  onModelChange,
  onAutoPushChange,
  showAutoPushParam = false,
  availableSdks,
  onSdkChange,
  formClassName = 'relative z-[2] shrink-0 bg-zinc-950 pb-3 sm:pb-4 pt-1',
  skipColumn = false,
  textareaId,
  canSend: canSendProp,
  submitDisabled = false,
  submitLabel = 'Send',
  submitTooltip,
  toolbarExtra,
  sendAddon,
  autoFocus = false,
  resizable = false,
  rows = 1,
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
      className={
        sendAddon
          ? `${SEND_BUTTON_SPLIT} ${SUBMIT_BUTTON_PADDING} rounded-l-lg`
          : `${SEND_BUTTON_BASE} ${SUBMIT_BUTTON_PADDING} rounded-lg`
      }
    >
      {sending ? '...' : submitLabel}
    </button>
  );

  const sendControl = sendAddon ? (
    <div className={COMPOSER_SPLIT_GROUP_CLASS}>
      {submitTooltip ? (
        <Tooltip content={submitTooltip} wrap placement="top-end">
          {sendButton}
        </Tooltip>
      ) : (
        sendButton
      )}
      {sendAddon}
    </div>
  ) : submitTooltip ? (
    <Tooltip content={submitTooltip} wrap placement="top-end">
      {sendButton}
    </Tooltip>
  ) : (
    sendButton
  );

  const box = (
    <div
      className={`w-full rounded-lg border border-zinc-700 bg-zinc-800 overflow-visible ${
        disabled ? 'opacity-60' : 'focus-within:ring-2 focus-within:ring-amber-500/50'
      }`}
    >
      <AutoGrowTextarea
        id={textareaId}
        rows={rows}
        maxHeightPx={resizable ? 320 : 160}
        keepManualResize={resizable}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || sending}
        autoFocus={autoFocus}
        className={
          resizable
            ? `${TEXTAREA_CLASS} max-h-[70vh] overflow-auto resize-y`
            : `${TEXTAREA_CLASS} resize-none`
        }
      />
      <div className="relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 pb-1.5 pt-0.5 rounded-b-lg overflow-visible min-w-0">
        <SessionModelSelect
          session={session}
          models={models}
          cursorModelPrefs={cursorModelPrefs}
          onCursorModelPrefChange={onCursorModelPrefChange}
          onModelChange={onModelChange}
          onAutoPushChange={onAutoPushChange}
          showAutoPushParam={showAutoPushParam}
          availableSdks={availableSdks}
          onSdkChange={onSdkChange}
          disabled={disabled || sending}
          className="min-w-0 flex-1 overflow-hidden"
        />
        <div className="flex shrink-0 items-center justify-end gap-1">
          {toolbarExtra}
          {sendControl}
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

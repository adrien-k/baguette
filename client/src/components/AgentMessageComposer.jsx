import SessionModelSelect from './SessionModelSelect.jsx';
import AutoGrowTextarea from './AutoGrowTextarea.jsx';
import { CHAT_COLUMN_CLASS } from './ChatMessagesViewport.jsx';
import Tooltip from './Tooltip.jsx';
import { isMobile } from '../utils/isMobile.js';

/** Shared height/layout with Send so toolbar actions (e.g. Stop, attach) align. */
export const COMPOSER_ACTION_BUTTON_LAYOUT =
  'inline-flex items-center justify-center shrink-0 h-8 text-sm font-medium';

const COMPOSER_SUBMIT_SUBTITLE_CLASS =
  'text-[9px] font-normal leading-none whitespace-nowrap opacity-70';

/** Amber fill shared by Send/Start and its caret; use inside `COMPOSER_SPLIT_GROUP_CLASS`. */
export const COMPOSER_SPLIT_AMBER_CLASS =
  'bg-brand hover:enabled:bg-brand-hover group-hover/split:enabled:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand transition-colors';

export const COMPOSER_SPLIT_GROUP_CLASS = 'group/split inline-flex items-stretch shrink-0';

const SEND_BUTTON_BASE = `${COMPOSER_ACTION_BUTTON_LAYOUT} bg-brand hover:enabled:bg-brand-hover disabled:bg-disabled disabled:text-faint text-on-brand border border-transparent transition-colors disabled:cursor-not-allowed`;

const SEND_BUTTON_SPLIT = `${COMPOSER_ACTION_BUTTON_LAYOUT} ${COMPOSER_SPLIT_AMBER_CLASS} border border-transparent border-r border-brand/40 group-hover/split:enabled:border-brand/50 disabled:border-r-track disabled:cursor-not-allowed`;

/** Tighter horizontal padding on small viewports; roomier from md up. */
const SUBMIT_BUTTON_PADDING = 'px-2.5 sm:px-3 md:px-4';

const TEXTAREA_CLASS =
  'block w-full bg-transparent px-2 sm:px-3 py-2.5 text-sm text-fg placeholder-faint focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-t-lg';

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
  sdk,
  model,
  params,
  autoPush = false,
  models,
  cursorModelPrefs,
  onCursorModelPrefChange,
  onModelChange,
  onAutoPushChange,
  showAutoPushParam = false,
  availableSdks,
  userSettings,
  sdkRepo,
  onSdkChange,
  formClassName = 'relative z-[2] shrink-0 bg-page pb-3 sm:pb-4 pt-1',
  skipColumn = false,
  textareaId,
  canSend: canSendProp,
  submitDisabled = false,
  submitLabel = 'Send',
  submitSubtitle,
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

  const submitPadding = submitSubtitle ? 'px-2 sm:px-2.5 md:px-3' : SUBMIT_BUTTON_PADDING;

  const submitHeightClass = submitSubtitle ? ' !h-9' : '';

  const sendButton = (
    <button
      type="submit"
      disabled={!canSubmit}
      className={
        sendAddon
          ? `${SEND_BUTTON_SPLIT} ${submitPadding}${submitHeightClass} rounded-l-lg`
          : `${SEND_BUTTON_BASE} ${submitPadding}${submitHeightClass} rounded-lg`
      }
    >
      {sending ? (
        '...'
      ) : submitSubtitle ? (
        <span className="flex flex-col items-center justify-center gap-px whitespace-nowrap leading-none">
          <span className="text-sm font-medium leading-none">{submitLabel}</span>
          <span className={COMPOSER_SUBMIT_SUBTITLE_CLASS}>{submitSubtitle}</span>
        </span>
      ) : (
        submitLabel
      )}
    </button>
  );

  const sendControl = sendAddon ? (
    <div
      className={
        submitSubtitle
          ? `${COMPOSER_SPLIT_GROUP_CLASS} [&>button]:!h-9`
          : COMPOSER_SPLIT_GROUP_CLASS
      }
    >
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
      className={`w-full rounded-lg border border-strong bg-control overflow-visible ${
        disabled ? 'opacity-60' : 'focus-within:ring-2 focus-within:ring-brand/50'
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
          sdk={sdk}
          model={model}
          params={params}
          autoPush={autoPush}
          models={models}
          cursorModelPrefs={cursorModelPrefs}
          onCursorModelPrefChange={onCursorModelPrefChange}
          onModelChange={onModelChange}
          onAutoPushChange={onAutoPushChange}
          showAutoPushParam={showAutoPushParam}
          availableSdks={availableSdks}
          userSettings={userSettings}
          sdkRepo={sdkRepo}
          onSdkChange={onSdkChange}
          disabled={disabled || sending}
          className="min-w-0 flex-1"
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

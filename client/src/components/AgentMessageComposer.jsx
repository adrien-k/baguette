import SessionModelSelect from './SessionModelSelect.jsx';
import ComposerTextarea from './ComposerTextarea.jsx';
import { CHAT_COLUMN_CLASS } from './ChatMessagesViewport.jsx';
import ButtonWithOptions from './ButtonWithOptions.jsx';
import { SPLIT_GROUP_CLASS, SPLIT_PRIMARY_CLASS } from './splitButtonStyles.js';

const COMPOSER_SUBMIT_SUBTITLE_CLASS =
  'text-[9px] font-normal leading-none whitespace-nowrap opacity-70';

const COMPOSER_SUBMIT_BUTTON_PADDING = 'px-2.5 sm:px-3 md:px-4';

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
  agentConfigKey,
  model,
  params,
  autoPush = false,
  models,
  cursorModelPrefs,
  onCursorModelPrefChange,
  onModelChange,
  onAutoPushChange,
  autoPushDisabled = false,
  showAutoPushParam = false,
  agentConfigOptions,
  onAgentConfigChange,
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
  hint,
}) {
  const handleChange = (e) => {
    onChange(e.target.value);
  };

  const hasDraft = canSendProp ?? Boolean(value.trim());
  const canSubmit = hasDraft && !disabled && !sending && !submitDisabled;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(e);
  };

  const submitPadding = submitSubtitle ? 'px-2 sm:px-2.5 md:px-3' : COMPOSER_SUBMIT_BUTTON_PADDING;

  const sendControl = (
    <ButtonWithOptions
      type="submit"
      disabled={!canSubmit}
      tooltip={submitTooltip}
      className={`${SPLIT_PRIMARY_CLASS} ${submitPadding}${submitSubtitle ? ' !h-9' : ''}`}
      groupClassName={submitSubtitle ? `${SPLIT_GROUP_CLASS} [&>button]:!h-9` : undefined}
      options={sendAddon}
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
    </ButtonWithOptions>
  );

  const box = (
    <div
      className={`w-full rounded-lg border border-strong bg-control overflow-visible ${
        disabled ? 'opacity-60' : 'focus-within:ring-2 focus-within:ring-brand/50'
      }`}
    >
      <ComposerTextarea
        id={textareaId}
        rows={rows}
        maxHeightPx={resizable ? 320 : 160}
        keepManualResize={resizable}
        value={value}
        onChange={handleChange}
        onSubmit={onSubmit}
        canSubmit={hasDraft && !submitDisabled}
        disabled={disabled || sending}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={
          resizable
            ? `${TEXTAREA_CLASS} max-h-[70vh] overflow-auto resize-y`
            : `${TEXTAREA_CLASS} resize-none`
        }
      />
      {hint ? <p className="px-2 sm:px-3 pb-1 text-xs text-faint">{hint}</p> : null}
      <div className="relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 pb-1.5 pt-0.5 rounded-b-lg overflow-visible min-w-0">
        <SessionModelSelect
          agentConfigKey={agentConfigKey}
          model={model}
          params={params}
          autoPush={autoPush}
          models={models}
          cursorModelPrefs={cursorModelPrefs}
          onCursorModelPrefChange={onCursorModelPrefChange}
          onModelChange={onModelChange}
          onAutoPushChange={onAutoPushChange}
          autoPushDisabled={autoPushDisabled}
          showAutoPushParam={showAutoPushParam}
          agentConfigOptions={agentConfigOptions}
          onAgentConfigChange={onAgentConfigChange}
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

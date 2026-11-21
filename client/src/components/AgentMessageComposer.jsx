import { useMemo } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import SessionModelSelect from './SessionModelSelect.jsx';
import ComposerTextarea from './ComposerTextarea.jsx';
import { CHAT_COLUMN_CLASS } from './ChatMessagesViewport.jsx';
import ButtonWithOptions from './ButtonWithOptions.jsx';
import { SPLIT_GROUP_CLASS, SPLIT_PRIMARY_CLASS } from './splitButtonStyles.js';
import LightChipDropdown from './LightChipDropdown.jsx';
import AgentTypeIcon from './AgentTypeIcon.jsx';
import Tooltip from './Tooltip.jsx';
import {
  agentDisplayTitle,
  agentMenuOptionLabel,
  agentSwitcherDropdownSections,
  isAgentTurnActive,
  isSubagentBuilder,
  otherAgentsRunningLabel,
} from '../utils/sessionAgents.js';
import ComposerRecipesDropdown from './ComposerRecipesDropdown.tsx';

const COMPOSER_SUBMIT_SUBTITLE_CLASS =
  'text-[9px] font-normal leading-none whitespace-nowrap opacity-70';

const COMPOSER_SUBMIT_BUTTON_PADDING = 'px-2.5 sm:px-3 md:px-4';

const TEXTAREA_CLASS =
  'block w-full bg-transparent px-2 sm:px-3 py-2.5 text-sm text-fg placeholder-faint focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-t-lg';

function runningTasksLabel(count) {
  if (count === 1) return '1 task running';
  return `${count} tasks running`;
}

function composerAgentSwitcherBadgeClass(agent) {
  if (isSubagentBuilder(agent)) {
    return 'bg-info/10 border-info/30 text-info hover:enabled:bg-info/20 hover:enabled:border-info/45';
  }
  if (agent?.agent_type === 'reviewer') {
    return 'bg-merged/10 border-merged/30 text-merged hover:enabled:bg-merged/20 hover:enabled:border-merged/45';
  }
  return 'bg-brand/15 border-brand/40 text-accent hover:enabled:bg-brand/25 hover:enabled:border-brand/50';
}

/** Spinner after the agent title — only while the currently selected agent is running. */
function SelectedAgentRunningSpinner({ agent }) {
  if (!isAgentTurnActive(agent?.status)) return null;
  return <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />;
}

/**
 * Count of agents still running besides the selected one: blinking robot icon
 * + number. Always the robot icon — the count spans every agent type. Hidden
 * when the selected agent is the only one running.
 */
function OtherRunningAgentsCount({ count }) {
  if (!count || count <= 0) return null;
  const label = otherAgentsRunningLabel(count);
  return (
    <Tooltip content={label}>
      <span
        className="flex items-center gap-0.5 shrink-0 tabular-nums text-[11px] opacity-80"
        aria-label={label}
      >
        <span className="motion-safe:animate-pulse inline-flex shrink-0" aria-hidden>
          <Bot className="w-3.5 h-3.5 shrink-0 text-accent" strokeWidth={2} />
        </span>
        {count}
      </span>
    </Tooltip>
  );
}

/**
 * Running-tasks count beside the selector: pulsing dot + number. Opens the
 * tasks side panel when `onShowTasks` is provided (session chat only).
 */
function RunningTasksCount({ count, onShowTasks }) {
  if (!count || count <= 0) return null;
  const label = runningTasksLabel(count);
  const content = (
    <>
      <span
        className="w-1.5 h-1.5 rounded-full bg-ok motion-safe:animate-pulse shrink-0"
        aria-hidden
      />
      {count}
    </>
  );
  if (!onShowTasks) {
    return (
      <Tooltip content={label}>
        <span
          className="flex items-center gap-1 shrink-0 tabular-nums text-[11px] text-secondary"
          aria-label={label}
        >
          {content}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onShowTasks}
        aria-label={label}
        title={label}
        className="flex items-center gap-1 shrink-0 rounded px-0.5 py-0.5 tabular-nums text-[11px] text-secondary hover:bg-control/50 transition-colors"
      >
        {content}
      </button>
    </Tooltip>
  );
}

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
  configsLoading = false,
  modelsLoading = false,
  formClassName = 'relative z-[2] shrink-0 bg-page pb-3 sm:pb-4 pt-1',
  skipColumn = false,
  textareaId,
  canSend: canSendProp,
  submitDisabled = false,
  submitLabel = 'Send',
  submitSubtitle,
  submitTooltip,
  showSubmitButton = true,
  toolbarExtra,
  sendAddon,
  autoFocus = false,
  resizable = false,
  rows = 1,
  fitPlaceholderWhenEmpty = false,
  hint,
  agentName,
  agentType,
  agents,
  selectedAgentId,
  onSelectAgent,
  agentOptionCostLabel,
  agentHeaderEnd,
  runningAgentCount = 0,
  runningTasksCount = 0,
  onShowTasks,
  mcpReadOnly = false,
  recipes,
  onRecipeSelect,
  disableEnterSubmit = false,
}) {
  const handleChange = (e) => {
    onChange(e.target.value);
  };

  const hasDraft = canSendProp ?? Boolean(value.trim());
  const canSubmit = hasDraft && !disabled && !sending && !submitDisabled;
  const composerChromeDisabled = disabled || sending;
  /** MCP subagents: composer is read-only but users must still switch agents in Baguette. */
  const agentSwitcherDisabled = mcpReadOnly ? sending : composerChromeDisabled;
  const dimComposerChrome = disabled && !mcpReadOnly;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(e);
  };

  const submitPadding = submitSubtitle ? 'px-2 sm:px-2.5 md:px-3' : COMPOSER_SUBMIT_BUTTON_PADDING;

  const sessionAgents = useMemo(() => (Array.isArray(agents) ? agents : []), [agents]);
  const agentFromList =
    sessionAgents.length && selectedAgentId != null
      ? sessionAgents.find((a) => a.id === selectedAgentId)
      : null;
  const headerAgent =
    agentFromList ?? (agentName || agentType ? { name: agentName, agent_type: agentType } : null);
  // Hide the count when the selected agent is the only one running.
  const otherRunningAgentCount = Math.max(
    0,
    runningAgentCount - (isAgentTurnActive(headerAgent?.status) ? 1 : 0)
  );
  const showAgentSwitcher = Boolean(
    sessionAgents.length > 1 && onSelectAgent && selectedAgentId != null
  );
  /**
   * Switcher + caret only when 2+ session agents; static label when `agents` is
   * not passed (e.g. review start). The header row also hosts the running-tasks
   * indicator, so it renders whenever there is agent chrome or tasks to show.
   */
  const showAgentChrome = Boolean(
    headerAgent &&
    (headerAgent.agent_type || headerAgent.name) &&
    (showAgentSwitcher || sessionAgents.length === 0 || mcpReadOnly)
  );
  const showRunningTasks = Boolean(runningTasksCount > 0);
  const showRecipesDropdown = Boolean(
    !mcpReadOnly && onRecipeSelect && Array.isArray(recipes) && recipes.length > 0
  );
  const showAgentHeader =
    showAgentChrome || (showRunningTasks && onShowTasks != null) || showRecipesDropdown;

  const agentTitleNode = (
    <span className="text-xs font-medium text-heading truncate">
      {agentDisplayTitle(headerAgent)}
    </span>
  );

  const agentSwitcherSections = useMemo(() => {
    return agentSwitcherDropdownSections(sessionAgents, (a) => {
      const costLabel = agentOptionCostLabel?.(a);
      const base = agentMenuOptionLabel(a);
      return {
        value: String(a.id),
        label: costLabel ? `${base} ${costLabel}` : base,
        icon: <AgentTypeIcon agentType={a.agent_type} subagent={isSubagentBuilder(a)} />,
      };
    });
  }, [sessionAgents, agentOptionCostLabel]);

  const agentSwitcherOptions = useMemo(() => {
    if (agentSwitcherSections) return undefined;
    return sessionAgents.map((a) => {
      const costLabel = agentOptionCostLabel?.(a);
      const base = agentMenuOptionLabel(a);
      return {
        value: String(a.id),
        label: costLabel ? `${base} ${costLabel}` : base,
        icon: <AgentTypeIcon agentType={a.agent_type} subagent={isSubagentBuilder(a)} />,
      };
    });
  }, [sessionAgents, agentOptionCostLabel, agentSwitcherSections]);

  const agentHeader = showAgentHeader ? (
    <div
      className={`flex items-center gap-2 px-2 sm:px-3 pt-2 pb-1 min-w-0${
        showAgentSwitcher && !agentHeaderEnd ? '' : ' border-b border-line/60'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {showAgentChrome &&
          (showAgentSwitcher ? (
            <LightChipDropdown
              layout="list"
              disabled={agentSwitcherDisabled}
              value={String(selectedAgentId)}
              onChange={(value) => {
                const picked = sessionAgents.find((a) => String(a.id) === value);
                if (picked) onSelectAgent(picked);
              }}
              options={agentSwitcherOptions}
              sections={agentSwitcherSections ?? undefined}
              selectedDisplay={{
                icon: (
                  <AgentTypeIcon
                    agentType={headerAgent.agent_type}
                    subagent={isSubagentBuilder(headerAgent)}
                  />
                ),
                content: (
                  <span className="flex items-center gap-1.5 min-w-0 max-w-full">
                    {agentTitleNode}
                    <SelectedAgentRunningSpinner agent={headerAgent} />
                  </span>
                ),
              }}
              ariaLabel="Switch agent"
              triggerAriaLabel="Switch agent"
              shrinkableTrigger
              triggerClassName={`gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors !h-auto min-h-0 max-w-full ${composerAgentSwitcherBadgeClass(
                headerAgent
              )}`}
            />
          ) : (
            <>
              <AgentTypeIcon
                agentType={headerAgent.agent_type}
                subagent={isSubagentBuilder(headerAgent)}
              />
              {agentTitleNode}
              <SelectedAgentRunningSpinner agent={headerAgent} />
            </>
          ))}
        {showRecipesDropdown ? (
          <ComposerRecipesDropdown
            recipes={recipes}
            disabled={composerChromeDisabled}
            onSelect={onRecipeSelect}
          />
        ) : null}
        <OtherRunningAgentsCount count={otherRunningAgentCount} />
        <RunningTasksCount count={runningTasksCount} onShowTasks={onShowTasks} />
      </div>
      {agentHeaderEnd ? <div className="shrink-0 ml-auto">{agentHeaderEnd}</div> : null}
    </div>
  ) : null;

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
        dimComposerChrome ? 'opacity-60' : 'focus-within:ring-2 focus-within:ring-brand/50'
      }`}
    >
      {agentHeader}
      {!mcpReadOnly ? (
        <ComposerTextarea
          id={textareaId}
          rows={rows}
          maxHeightPx={resizable ? 320 : 160}
          keepManualResize={resizable}
          value={value}
          onChange={handleChange}
          onSubmit={disableEnterSubmit ? undefined : onSubmit}
          canSubmit={hasDraft && !submitDisabled}
          disabled={disabled || sending}
          placeholder={placeholder}
          fitPlaceholderWhenEmpty={fitPlaceholderWhenEmpty}
          autoFocus={autoFocus}
          className={
            resizable
              ? `${TEXTAREA_CLASS} max-h-[70vh] overflow-auto resize-y`
              : `${TEXTAREA_CLASS} resize-none`
          }
        />
      ) : null}
      {hint ? (
        <p
          className={`px-2 sm:px-3 text-xs text-faint text-center${
            mcpReadOnly ? ' pt-2.5 pb-1' : ' pb-1'
          }`}
        >
          {hint}
        </p>
      ) : null}
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
          showAutoPushParam={showAutoPushParam && !mcpReadOnly}
          agentConfigOptions={agentConfigOptions}
          onAgentConfigChange={onAgentConfigChange}
          configsLoading={configsLoading}
          modelsLoading={modelsLoading}
          disabled={composerChromeDisabled || mcpReadOnly}
          className="min-w-0 flex-1"
        />
        {!mcpReadOnly ? (
          <div className="flex shrink-0 items-center justify-end gap-1">
            {toolbarExtra}
            {showSubmitButton ? sendControl : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className={formClassName}>
      {skipColumn ? box : <div className={CHAT_COLUMN_CLASS}>{box}</div>}
    </form>
  );
}

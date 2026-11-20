import { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ClipboardCheck,
  Crown,
  Loader2,
  Network,
  Pencil,
  Pin,
  Plus,
} from 'lucide-react';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import AgentTypeIcon from './AgentTypeIcon.jsx';
import Tooltip from './Tooltip.jsx';
import { SessionStatusIcon } from './SessionCard.jsx';
import { agentsService, sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { buildSessionAgentList } from '../utils/sessionAgentList.js';
import {
  agentAccessibleTitle,
  agentDisplayTitle,
  isAgentAwaitingUser,
  isAgentTurnActive,
  isAgentTreeCollapseLocked,
  isPrimaryAgent,
  isReviewerAgent,
  isSecondaryBuilder,
  isSubagentBuilder,
} from '../utils/sessionAgents.js';
import { messageModelDisplayName } from '../utils/messageModelLabel.js';
import { formatUsd } from '../utils/usageSeries.js';
import { useAgentConfigContext } from '../context/AgentConfigContext.jsx';
import { useAgentConfigModels } from '../hooks/useAgentConfigModels.js';
import { parseModelField } from '../utils/models.js';

const PRIMARY_BUILDER_ROW_TOOLTIP =
  'This session’s primary builder. Messages sent without picking an agent are delivered here by default.';

const SECONDARY_BUILDER_ROW_TOOLTIP = 'Extra builder added from the UI';

const REVIEWER_ROW_TOOLTIP =
  'Session reviewer — reviews the diff and manage issues on the Issues tab';

const SUBAGENT_ROW_TOOLTIP = 'Subagent started and managed by a builder. Chat here is read-only.';

/** Status glyph between agent name and model — hidden for quiet idle rows. */
function AgentTreeStatus({ status }) {
  if (isAgentTurnActive(status) || status === 'provisioning') {
    return <Loader2 className="w-3 h-3 shrink-0 text-success animate-spin" aria-hidden />;
  }
  if (isAgentAwaitingUser(status)) {
    return <SessionStatusIcon status="approval" compact aria-hidden />;
  }
  if (status === 'failed' || status === 'error') {
    return <SessionStatusIcon status="failed" compact aria-hidden />;
  }
  return null;
}

/** Model display name (catalog name when available, else the raw id) and formatted usage cost. */
function useAgentModelMeta(agentConfigId, model, costUsd) {
  const enabled = agentConfigId != null;
  const { models } = useAgentConfigModels(agentConfigId ?? null, { enabled });
  const label = model
    ? messageModelDisplayName({ model, models: enabled ? models : [] }) || parseModelField(model)
    : null;
  const cost = Number(costUsd) > 0 ? formatUsd(Number(costUsd)) : null;
  return { label, cost };
}

/** Provider icon, wrapped in a model / cost tooltip when either is known. */
function AgentTreeIcon({ agent, config }) {
  const { label, cost } = useAgentModelMeta(agent.agent_config_id, agent.model, agent.cost_usd);
  const icon = config ? (
    <AgentConfigLogo sdk={config.sdk} logo={config.logo} className="w-3.5 h-3.5 shrink-0" />
  ) : (
    <AgentTypeIcon agentType={agent.agent_type} />
  );
  if (!label && !cost) return icon;
  return <Tooltip content={[label, cost].filter(Boolean).join(' · ')}>{icon}</Tooltip>;
}

/**
 * Inline model label (cost stays off the line — it lives in the icon tooltip).
 * Collapses to zero width before the agent name truncates, so it disappears
 * first when available width is tight.
 */
function AgentTreeModelLabel({ agentConfigId, model }) {
  const { label } = useAgentModelMeta(agentConfigId, model, null);
  if (!label) return null;
  return (
    <span className="min-w-0 max-w-[7rem] shrink-[9999] truncate font-mono text-[10px] text-faint tabular-nums">
      {label}
    </span>
  );
}

/**
 * Small rename affordance trailing the title. Turns are stopped from the
 * chat composer and agents are not deletable from the list, so this is the
 * only per-row action. Only extra builders are renameable — the primary
 * builder, reviewer, and MCP subagents keep a fixed title.
 */
function AgentTreeEdit({ agent, canManage, renaming, onRequestRename }) {
  if (!canManage || !isSecondaryBuilder(agent) || renaming) return null;
  return (
    <button
      type="button"
      title="Rename agent"
      aria-label={`Rename ${agentDisplayTitle(agent)}`}
      onClick={(e) => {
        e.stopPropagation();
        onRequestRename(agent);
      }}
      className="shrink-0 p-0.5 rounded text-faint hover:text-fg md:opacity-0 md:group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity"
    >
      <Pencil className="w-3 h-3" aria-hidden />
    </button>
  );
}

function AgentTreeAddBuilder({ agent, canManage, renaming, onAddBuilder, showAddBuilder }) {
  if (!showAddBuilder || !canManage || renaming || !isPrimaryAgent(agent) || !onAddBuilder)
    return null;
  return (
    <button
      type="button"
      title="Add builder"
      aria-label="Add builder"
      onClick={(e) => {
        e.stopPropagation();
        onAddBuilder();
      }}
      className="shrink-0 p-0.5 rounded text-faint hover:text-fg"
    >
      <Plus className="w-3 h-3" aria-hidden />
    </button>
  );
}

function AgentTreePin({ agent, canManage, renaming, pinnedAgentId, pinSaving, onTogglePin }) {
  if (!canManage || renaming || !isSecondaryBuilder(agent)) return null;
  const isPinned =
    pinnedAgentId != null && pinnedAgentId !== '' && Number(pinnedAgentId) === agent.id;
  const title = isPinned ? 'Unpin agent' : 'Pin agent';
  return (
    <button
      type="button"
      title={title}
      aria-label={`${title} — ${agentDisplayTitle(agent)}`}
      aria-pressed={isPinned}
      disabled={pinSaving}
      onClick={(e) => {
        e.stopPropagation();
        onTogglePin(agent);
      }}
      className={`shrink-0 p-0.5 rounded transition-opacity disabled:opacity-40 focus-visible:opacity-100 ${
        isPinned
          ? 'text-accent'
          : 'text-faint hover:text-fg md:opacity-0 md:group-hover/row:opacity-100'
      }`}
    >
      <Pin className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} aria-hidden />
    </button>
  );
}

function agentTreeCaretLabel(expanded, locked) {
  if (locked) return 'Other agents stay visible while this agent is open';
  if (expanded) return 'Hide agents';
  return 'Show agents';
}

/** Disclosure caret for the builder's agent group. */
function AgentTreeCaret({ expanded, onToggle, collapseLocked = false }) {
  const locked = expanded && collapseLocked;
  return (
    <button
      type="button"
      data-testid="agent-tree-toggle"
      aria-expanded={expanded}
      aria-disabled={locked || undefined}
      aria-label={agentTreeCaretLabel(expanded, locked)}
      title={locked ? 'Open the default agent to hide the others' : undefined}
      onClick={locked ? undefined : onToggle}
      className={`shrink-0 -my-1 p-0.5 transition-colors ${
        locked ? 'cursor-default text-faint/40' : 'text-faint hover:text-fg'
      }`}
    >
      <ChevronDown
        className={`w-3.5 h-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
        aria-hidden
      />
    </button>
  );
}

/**
 * Quiet pill behind the agent name: primary and extra builders share brand;
 * reviewer uses merged tint. Subagents use a leading icon instead of fill.
 */
function agentNameToneClass(agent) {
  if (isPrimaryAgent(agent) || isSecondaryBuilder(agent)) return 'bg-brand/15';
  if (isReviewerAgent(agent)) return 'bg-merged/10';
  return '';
}

function AgentTreeRoleIcon({ agent }) {
  let tooltip = null;
  let icon = null;
  if (isPrimaryAgent(agent)) {
    tooltip = PRIMARY_BUILDER_ROW_TOOLTIP;
    icon = <Crown className="w-3 h-3 text-brand" aria-label="Primary builder" />;
  } else if (isSecondaryBuilder(agent)) {
    tooltip = SECONDARY_BUILDER_ROW_TOOLTIP;
    icon = <Bot className="w-3 h-3 text-accent" strokeWidth={2} aria-hidden />;
  } else if (isReviewerAgent(agent)) {
    tooltip = REVIEWER_ROW_TOOLTIP;
    icon = <ClipboardCheck className="w-3 h-3 text-merged" strokeWidth={2} aria-hidden />;
  } else if (isSubagentBuilder(agent)) {
    tooltip = SUBAGENT_ROW_TOOLTIP;
    icon = <Network className="w-3 h-3 text-info" strokeWidth={2} aria-hidden />;
  }
  if (!tooltip || !icon) return null;
  return (
    <Tooltip content={tooltip} wrap wide className="inline-flex shrink-0">
      {icon}
    </Tooltip>
  );
}

function selectedAgentRowBorderClass(isCurrent, sessionHighlighted) {
  if (!isCurrent) return 'border-transparent hover:bg-control/50';
  if (sessionHighlighted) return 'border-faint';
  return 'border-control-hover';
}

function AgentTreeNameLabel({ agent, agentRef, title, isCurrent }) {
  const nameLabel = (
    <span
      className={`min-w-0 truncate rounded px-1 text-[11px] leading-4 inline-flex items-center gap-1 ${agentNameToneClass(
        agent
      )} ${isCurrent ? 'text-fg' : 'text-secondary'}`}
    >
      <AgentTreeRoleIcon agent={agent} />
      {agentRef != null ? (
        <span className="shrink-0 font-mono text-[10px] text-faint tabular-nums">#{agentRef}</span>
      ) : null}
      <span className="truncate">{title}</span>
    </span>
  );
  return nameLabel;
}

function AgentTreeRow({ agent, ...rest }) {
  const { getConfig } = useAgentConfigContext();
  const config = getConfig(agent.agent_config_id);
  const title = agentDisplayTitle(agent);
  const accessibleTitle = agentAccessibleTitle(agent);
  const agentRef = agent.ref ?? null;
  const {
    currentAgentId,
    canManage,
    renamingAgentId,
    renameValue,
    renameSaving,
    onSelectAgent,
    onRenameChange,
    onCommitRename,
    onCancelRename,
    onRequestRename,
    pinnedAgentId,
    pinSaving,
    onTogglePin,
    onAddBuilder,
    showAddBuilder,
    sessionHighlighted,
  } = rest;
  const isCurrent = currentAgentId != null && Number(currentAgentId) === agent.id;
  const renaming = renamingAgentId === agent.id;
  const modelLabelNode = (
    <AgentTreeModelLabel agentConfigId={agent.agent_config_id} model={agent.model} />
  );

  return (
    <li>
      <div
        data-testid="agent-tree-row"
        data-agent-name={agent.name || title}
        data-selected={isCurrent ? 'true' : 'false'}
        aria-current={isCurrent ? 'true' : undefined}
        className={`group/row flex items-center gap-1.5 rounded-md border py-1 pl-1 pr-1.5 transition-colors ${selectedAgentRowBorderClass(
          isCurrent,
          sessionHighlighted
        )}`}
      >
        <AgentTreeIcon agent={agent} config={config} />
        <button
          type="button"
          onClick={() => onSelectAgent(agent)}
          title={isAgentTurnActive(agent.status) ? 'Turn running' : `Open ${accessibleTitle} chat`}
          className={`min-w-0 flex items-center gap-1.5 text-left ${renaming ? 'flex-1' : ''}`}
        >
          {renaming ? (
            <input
              type="text"
              value={renameValue}
              disabled={renameSaving}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitRename(agent);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={() => onCommitRename(agent)}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              className="h-4 flex-1 min-w-0 rounded border border-line bg-control px-1.5 py-0 text-xs text-heading"
            />
          ) : (
            <AgentTreeNameLabel
              agent={agent}
              agentRef={agentRef}
              title={title}
              isCurrent={isCurrent}
            />
          )}
          <AgentTreeStatus status={agent.status} />
        </button>
        <AgentTreeAddBuilder
          agent={agent}
          canManage={canManage}
          renaming={renaming}
          onAddBuilder={onAddBuilder}
          showAddBuilder={showAddBuilder}
        />
        <AgentTreePin
          agent={agent}
          canManage={canManage}
          renaming={renaming}
          pinnedAgentId={pinnedAgentId}
          pinSaving={pinSaving}
          onTogglePin={onTogglePin}
        />
        <AgentTreeEdit
          agent={agent}
          canManage={canManage}
          renaming={renaming}
          onRequestRename={onRequestRename}
        />
        {!renaming ? (
          <button
            type="button"
            onClick={() => onSelectAgent(agent)}
            title={`Open ${accessibleTitle} chat`}
            aria-label={`Open ${accessibleTitle} chat`}
            className="flex min-w-0 grow cursor-pointer items-center justify-end"
          >
            {modelLabelNode}
          </button>
        ) : (
          <>
            <span className="grow" aria-hidden />
            {modelLabelNode}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Agent group for a session row. A disclosure caret in the session-status column
 * toggles extra agents, except while a non-primary agent is selected — collapsing
 * would hide the open chat. Every row shares the same indent in the title column.
 * `autoExpanded` is the default (selected session on desktop, last-opened on
 * mobile), overridable via the caret. Builder and reviewer rows carry a quiet
 * brand/merged/info name-pill tints. On the session highlight fill the open agent
 * uses a faint border for contrast; off the fill it uses control-hover. Rows show
 * provider icon · `#ref` · name · status · rename affordance · model (on the right).
 */
export default function SessionAgentTree({
  agents,
  sessionId,
  pinnedAgentId = null,
  currentAgentId,
  canManage,
  onSelectAgent,
  onPinnedAgentIdChange,
  onAddBuilder,
  showAddBuilder = false,
  autoExpanded = false,
  showOwnerGutter = false,
  sessionHighlighted = false,
}) {
  const list = buildSessionAgentList(agents, pinnedAgentId);
  const [renamingAgentId, setRenamingAgentId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  // null = follow the auto-expanded default; true/false = manual caret override.
  const [manuallyExpanded, setManuallyExpanded] = useState(null);

  if (!list.length) return null;

  const primaryAgent = list.find(isPrimaryAgent) ?? null;
  const headAgent = list[0] ?? null;
  const tailAfterHead = headAgent ? list.slice(1) : list;
  const primaryPinnedSlot =
    primaryAgent && headAgent && primaryAgent.id !== headAgent.id ? primaryAgent : null;
  const collapsibleOthers = primaryPinnedSlot
    ? tailAfterHead.filter((a) => a.id !== primaryAgent.id)
    : tailAfterHead;
  const grouped = Boolean(headAgent) && collapsibleOthers.length > 0;
  const collapseLocked = isAgentTreeCollapseLocked(list, currentAgentId, headAgent?.id);
  const expanded = collapseLocked || (manuallyExpanded ?? autoExpanded);
  const caret = grouped
    ? {
        expanded,
        collapseLocked,
        onToggle: () => setManuallyExpanded(!expanded),
      }
    : null;

  const startRename = (agent) => {
    if (!isSecondaryBuilder(agent)) return;
    setRenamingAgentId(agent.id);
    setRenameValue(agent.name?.trim() || agentDisplayTitle(agent));
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingAgentId(null);
    setRenameValue('');
  };

  const togglePin = async (agent) => {
    if (pinSaving || sessionId == null) return;
    const isPinned =
      pinnedAgentId != null && pinnedAgentId !== '' && Number(pinnedAgentId) === agent.id;
    const nextId = isPinned ? null : agent.id;
    setPinSaving(true);
    try {
      await sessionsService.patch(sessionId, { pinned_agent_id: nextId });
      onPinnedAgentIdChange?.(nextId);
    } catch (err) {
      toastError(isPinned ? 'Failed to unpin agent' : 'Failed to pin agent', err);
    } finally {
      setPinSaving(false);
    }
  };

  const commitRename = async (agent) => {
    if (renameSaving || renamingAgentId !== agent.id) return;
    const trimmed = renameValue.trim();
    const current = agent.name?.trim() || '';
    if (!trimmed || trimmed === current) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    try {
      await agentsService.patch(agent.id, { name: trimmed });
      setRenamingAgentId(null);
      setRenameValue('');
    } catch (err) {
      toastError('Failed to rename agent', err);
    } finally {
      setRenameSaving(false);
    }
  };

  const rowProps = {
    currentAgentId,
    canManage,
    renamingAgentId,
    renameValue,
    renameSaving,
    onSelectAgent,
    onRenameChange: setRenameValue,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
    onRequestRename: startRename,
    pinnedAgentId,
    pinSaving,
    onTogglePin: togglePin,
    onAddBuilder,
    showAddBuilder,
    sessionHighlighted,
  };

  const visibleAgents = [
    ...(headAgent ? [headAgent] : []),
    ...(primaryPinnedSlot ? [primaryPinnedSlot] : []),
    ...(!grouped || expanded ? collapsibleOthers : []),
  ];

  return (
    <div className="mt-0.5 flex items-start gap-2">
      <span className="mt-0.5 flex h-4 w-3 shrink-0 items-center justify-center">
        {caret ? (
          <AgentTreeCaret
            expanded={caret.expanded}
            collapseLocked={caret.collapseLocked}
            onToggle={caret.onToggle}
          />
        ) : null}
      </span>
      {showOwnerGutter && <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      {/* Scroll breakpoint at 10 rows: rows are py-1 + a 16px line box (24px) with a
          2px gap between the builder and others groups — 10 rows = 242px, 11 = 266px,
          so max-h-64 (256px) fits ten rows and scrolls from the eleventh. */}
      <div
        className="min-w-0 flex-1 space-y-0.5 max-h-64 overflow-y-auto"
        data-testid="session-agent-tree"
      >
        <ul>
          {visibleAgents.map((agent) => (
            <AgentTreeRow key={agent.id} agent={agent} {...rowProps} />
          ))}
        </ul>
      </div>
    </div>
  );
}

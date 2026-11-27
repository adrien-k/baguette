import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ClipboardCheck,
  Crown,
  Loader2,
  Network,
  Pencil,
  Plus,
} from 'lucide-react';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import AgentTypeIcon from './AgentTypeIcon.jsx';
import Tooltip from './Tooltip.jsx';
import { SessionStatusIcon } from './SessionCard.jsx';
import { agentsService } from '../feathers.js';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import SetPrimaryConfirmModal from './SetPrimaryConfirmModal.jsx';
import {
  buildSessionAgentTree,
  nodeHasDescendantAgent,
  summarizeNodeDescendants,
} from '../utils/sessionAgentList.js';
import {
  agentAccessibleTitle,
  agentDisplayTitle,
  isAgentAwaitingUser,
  isAgentTurnActive,
  isPrimaryAgent,
  isReviewerAgent,
  isRenamableBuilder,
  isSecondaryBuilder,
  isSubagentBuilder,
} from '../utils/sessionAgents.js';
import { TrailingHoverBackdrop } from './TrailingHoverActions.jsx';
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
function AgentTreeIcon({ agent, config, onSelectAgent }) {
  const { label, cost } = useAgentModelMeta(agent.agent_config_id, agent.model, agent.cost_usd);
  const icon = config ? (
    <AgentConfigLogo sdk={config.sdk} logo={config.logo} className="w-3.5 h-3.5 shrink-0" />
  ) : (
    <AgentTypeIcon agentType={agent.agent_type} />
  );
  const selectClick = onSelectAgent ? () => onSelectAgent(agent) : undefined;
  const hitTargetClass = onSelectAgent ? 'pointer-events-auto cursor-pointer shrink-0' : 'shrink-0';
  if (!label && !cost) {
    return (
      <span className={hitTargetClass} onClick={selectClick} role="presentation">
        {icon}
      </span>
    );
  }
  return (
    <Tooltip
      content={[label, cost].filter(Boolean).join(' · ')}
      className={`inline-flex items-stretch ${hitTargetClass}`}
      onReferenceClick={selectClick}
    >
      {icon}
    </Tooltip>
  );
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

const EDIT_BUTTON_RESERVE_PX = 20;
const SET_PRIMARY_BUTTON_RESERVE_PX = 20;

const EDIT_HOVER_REVEAL =
  'md:opacity-0 md:pointer-events-none md:transition-opacity md:group-hover/row:pointer-events-auto md:group-hover/row:opacity-100 md:focus-within:pointer-events-auto md:focus-within:opacity-100';

/** Crown hover action on secondary builders to promote them to primary. */
function AgentTreeSetPrimary({
  agent,
  canManage,
  renaming,
  onRequestSetPrimary,
  overlay = false,
  sessionHighlighted = false,
  isCurrent = false,
}) {
  if (!canManage || !isSecondaryBuilder(agent) || renaming) return null;
  const positionClass = overlay
    ? 'absolute right-5 top-1/2 z-[1] -translate-y-1/2 py-0.5 pl-2 pr-0.5'
    : 'relative z-[1] shrink-0';

  return (
    <span
      data-testid="agent-tree-set-primary"
      className={`pointer-events-auto inline-flex items-center ${positionClass} ${EDIT_HOVER_REVEAL}`}
    >
      {overlay ? (
        <TrailingHoverBackdrop
          sessionHighlighted={sessionHighlighted}
          extraHoverWash={!isCurrent}
          showOnMobile
        />
      ) : null}
      <button
        type="button"
        title="Make primary builder"
        aria-label={`Make ${agentDisplayTitle(agent)} the primary builder`}
        onClick={(e) => {
          e.stopPropagation();
          onRequestSetPrimary(agent);
        }}
        className="relative z-[1] shrink-0 rounded p-0.5 text-faint hover:text-brand"
      >
        <Crown className="w-3 h-3" aria-hidden />
      </button>
    </span>
  );
}

/**
 * Small rename affordance trailing the agent label (or overlaid on its right
 * edge when the label takes the whole available width). Reviewer and MCP subagent
 * rows keep a fixed title.
 */
function AgentTreeEdit({
  agent,
  canManage,
  renaming,
  onRequestRename,
  overlay = false,
  sessionHighlighted = false,
  isCurrent = false,
}) {
  if (!canManage || !isRenamableBuilder(agent) || renaming) return null;
  const positionClass = overlay
    ? 'absolute right-0 top-1/2 z-[1] -translate-y-1/2 py-0.5 pl-3 pr-0.5'
    : 'relative z-[1] shrink-0';

  return (
    <span
      data-testid="agent-tree-edit"
      data-overlay={overlay ? 'true' : 'false'}
      className={`pointer-events-auto inline-flex items-center ${positionClass} ${EDIT_HOVER_REVEAL}`}
    >
      {overlay ? (
        <TrailingHoverBackdrop
          sessionHighlighted={sessionHighlighted}
          extraHoverWash={!isCurrent}
          showOnMobile
        />
      ) : null}
      <button
        type="button"
        title="Rename agent"
        aria-label={`Rename ${agentDisplayTitle(agent)}`}
        onClick={(e) => {
          e.stopPropagation();
          onRequestRename(agent);
        }}
        className="relative z-[1] shrink-0 rounded p-0.5 text-faint hover:text-fg"
      >
        <Pencil className="w-3 h-3" aria-hidden />
      </button>
    </span>
  );
}

function SubagentStatusDot({ hasRunning, hasApproval, hasFailed }) {
  if (hasRunning) {
    return <Loader2 className="h-2.5 w-2.5 shrink-0 text-success animate-spin" aria-hidden />;
  }
  if (hasApproval) {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />;
  }
  if (hasFailed) {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden />;
  }
  return null;
}

/** Disclosure pill on a builder (or parent subagent) row to toggle its nested subagents. */
function BuilderSubagentsToggle({ node, expanded, onToggle }) {
  const { count, hasRunning, hasApproval, hasFailed } = summarizeNodeDescendants(node);
  if (count === 0) return null;
  const label = expanded ? 'Hide subagents' : 'Show subagents';
  const title = `${label} (${count})`;
  return (
    <button
      type="button"
      data-testid="builder-subagents-toggle"
      aria-expanded={expanded}
      aria-label={`${label} for ${agentDisplayTitle(node.agent)}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="pointer-events-auto relative z-[1] inline-flex shrink-0 items-center gap-0.5 rounded bg-control/70 px-1 py-0.5 text-[10px] leading-3 font-medium text-faint transition-colors hover:bg-control hover:text-fg"
    >
      {!expanded && (
        <SubagentStatusDot
          hasRunning={hasRunning}
          hasApproval={hasApproval}
          hasFailed={hasFailed}
        />
      )}
      <span className="tabular-nums">{count}</span>
      <ChevronDown
        className={`h-2.5 w-2.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
        aria-hidden
      />
    </button>
  );
}

/** Trailing slot: model label, collapsing before the agent name truncates. */
function AgentTreeTrailingSlot({ agent }) {
  return (
    <span className="ml-auto flex min-w-0 max-w-[7rem] shrink-[9999] items-center justify-end empty:hidden">
      <AgentTreeModelLabel agentConfigId={agent.agent_config_id} model={agent.model} />
    </span>
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

function AgentTreeRoleIcon({ agent, onSelectAgent }) {
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
  const selectClick = onSelectAgent ? () => onSelectAgent(agent) : undefined;
  const hitTargetClass = onSelectAgent
    ? 'inline-flex shrink-0 pointer-events-auto cursor-pointer'
    : 'inline-flex shrink-0';
  return (
    <Tooltip content={tooltip} wrap wide className={hitTargetClass} onReferenceClick={selectClick}>
      {icon}
    </Tooltip>
  );
}

function selectedAgentRowBorderClass(isCurrent, sessionHighlighted) {
  if (!isCurrent) return 'border-transparent hover:bg-control/50';
  if (sessionHighlighted) return 'border-faint bg-control/35';
  return 'border-control-hover bg-control/35';
}

function AgentTreeNameLabel({
  agent,
  agentRef,
  title,
  isCurrent,
  onSelectAgent,
  labelRef,
  titleRef,
}) {
  return (
    <span
      ref={labelRef}
      className={`min-w-0 truncate rounded px-1 text-[11px] leading-4 inline-flex items-center gap-1 ${agentNameToneClass(
        agent
      )} ${isCurrent ? 'text-fg font-medium' : 'text-secondary'}`}
    >
      <AgentTreeRoleIcon agent={agent} onSelectAgent={onSelectAgent} />
      {agentRef != null ? (
        <span className="shrink-0 font-mono text-[10px] text-faint tabular-nums">#{agentRef}</span>
      ) : null}
      <span ref={titleRef} className="truncate">
        {title}
      </span>
    </span>
  );
}

/**
 * Renders the agent name label with an inline edit button on its right when
 * there is room, or overlaid on its right edge when the label fills the
 * available width.
 */
function AgentNameWithEdit({
  agent,
  agentRef,
  title,
  isCurrent,
  onSelectAgent,
  canManage,
  renaming,
  onRequestRename,
  onRequestSetPrimary,
  sessionHighlighted,
}) {
  const showSetPrimary = canManage && !renaming && isSecondaryBuilder(agent);
  const showEdit = canManage && !renaming && isRenamableBuilder(agent);
  const containerRef = useRef(null);
  const labelRef = useRef(null);
  const titleRef = useRef(null);
  const [overlayEdit, setOverlayEdit] = useState(false);

  useLayoutEffect(() => {
    if (!showEdit && !showSetPrimary) {
      setOverlayEdit(false);
      return undefined;
    }
    const container = containerRef.current;
    const label = labelRef.current;
    const titleEl = titleRef.current;
    const parent = container?.parentElement;
    if (!container || !label || !titleEl || !parent) return undefined;

    const update = () => {
      const children = Array.from(parent.children);
      let otherWidth = 0;
      for (const child of children) {
        if (child !== container) otherWidth += child.offsetWidth;
      }
      const gapPx = parseFloat(getComputedStyle(parent).columnGap) || 6;
      const totalGap = Math.max(0, children.length - 1) * gapPx;
      const available = parent.clientWidth - otherWidth - totalGap;
      if (available <= 0) return;

      const overflow = Math.max(0, titleEl.scrollWidth - titleEl.clientWidth);
      const labelNaturalWidth = label.clientWidth + overflow;
      const actionReserve =
        (showEdit ? EDIT_BUTTON_RESERVE_PX : 0) +
        (showSetPrimary ? SET_PRIMARY_BUTTON_RESERVE_PX : 0);
      setOverlayEdit(labelNaturalWidth + actionReserve > available);
    };

    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [showEdit, showSetPrimary, title, agentRef, agent.status]);

  return (
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-1">
      <AgentTreeNameLabel
        agent={agent}
        agentRef={agentRef}
        title={title}
        isCurrent={isCurrent}
        onSelectAgent={onSelectAgent}
        labelRef={labelRef}
        titleRef={titleRef}
      />
      {showSetPrimary ? (
        <AgentTreeSetPrimary
          agent={agent}
          canManage={canManage}
          renaming={renaming}
          onRequestSetPrimary={onRequestSetPrimary}
          overlay={overlayEdit}
          sessionHighlighted={sessionHighlighted}
          isCurrent={isCurrent}
        />
      ) : null}
      {showEdit ? (
        <AgentTreeEdit
          agent={agent}
          canManage={canManage}
          renaming={renaming}
          onRequestRename={onRequestRename}
          overlay={overlayEdit}
          sessionHighlighted={sessionHighlighted}
          isCurrent={isCurrent}
        />
      ) : null}
    </div>
  );
}

function AgentTreeNode({ node, ...rest }) {
  const { agent, children } = node;
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
    onRequestSetPrimary,
    sessionHighlighted,
    expandedByParentId,
    onToggleParentExpanded,
  } = rest;

  const isCurrent = currentAgentId != null && Number(currentAgentId) === agent.id;
  const renaming = renamingAgentId === agent.id;
  const hasChildren = children.length > 0;
  const hasSelectedDescendant = hasChildren && nodeHasDescendantAgent(node, currentAgentId);
  const isExpanded = expandedByParentId[agent.id] ?? hasSelectedDescendant;

  return (
    <li>
      <div
        data-testid="agent-tree-row"
        data-agent-id={agent.id}
        data-agent-type={agent.agent_type}
        data-agent-name={agent.name || title}
        data-selected={isCurrent ? 'true' : 'false'}
        aria-current={isCurrent ? 'true' : undefined}
        className={`group/row relative flex items-center gap-1.5 rounded-md border px-1 py-1 transition-colors ${selectedAgentRowBorderClass(
          isCurrent,
          sessionHighlighted
        )}`}
      >
        {!renaming ? (
          <button
            type="button"
            onClick={() => onSelectAgent(agent)}
            title={
              isAgentTurnActive(agent.status) ? 'Turn running' : `Open ${accessibleTitle} chat`
            }
            aria-label={`Open ${accessibleTitle} chat`}
            className="absolute inset-0 z-0 rounded-md"
          />
        ) : null}
        <div className="relative z-[1] flex min-w-0 flex-1 items-center gap-1.5 pointer-events-none">
          <AgentTreeIcon
            agent={agent}
            config={config}
            onSelectAgent={renaming ? undefined : onSelectAgent}
          />
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
              className="pointer-events-auto h-4 flex-1 min-w-0 rounded border border-line bg-control px-1.5 py-0 text-xs text-heading"
            />
          ) : (
            <AgentNameWithEdit
              agent={agent}
              agentRef={agentRef}
              title={title}
              isCurrent={isCurrent}
              onSelectAgent={onSelectAgent}
              canManage={canManage}
              renaming={renaming}
              onRequestRename={onRequestRename}
              onRequestSetPrimary={onRequestSetPrimary}
              sessionHighlighted={sessionHighlighted}
            />
          )}
          {!renaming ? <AgentTreeStatus status={agent.status} /> : null}
        </div>
        {!renaming && hasChildren ? (
          <BuilderSubagentsToggle
            node={node}
            expanded={isExpanded}
            onToggle={() => onToggleParentExpanded(agent.id, !isExpanded)}
          />
        ) : null}
        {!renaming ? (
          <AgentTreeTrailingSlot agent={agent} />
        ) : (
          <span className="ml-auto shrink-0" aria-hidden />
        )}
      </div>
      {hasChildren && isExpanded ? (
        <ul
          data-testid="builder-subagents-list"
          className="ml-2.5 mt-0.5 space-y-0.5 border-l border-line/70 pl-2"
        >
          {children.map((childNode) => (
            <AgentTreeNode key={childNode.agent.id} node={childNode} {...rest} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Agent tree shown for the selected session (desktop) or expanded session (mobile):
 * - Optional "+ Add builder" button at the very top of the list.
 * - Builders ordered by most recent last activity first, with subagents nested
 *   under their parent builder behind a toggle pill.
 * - Session reviewer listed after builders.
 */
export default function SessionAgentTree({
  agents,
  currentAgentId,
  canManage,
  onSelectAgent,
  onAddBuilder,
  showAddBuilder = false,
  showOwnerGutter = false,
  sessionHighlighted = false,
}) {
  const { builders, reviewers, orphans } = useMemo(() => buildSessionAgentTree(agents), [agents]);

  const [renamingAgentId, setRenamingAgentId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [pendingPrimaryAgent, setPendingPrimaryAgent] = useState(null);
  const [setPrimarySaving, setSetPrimarySaving] = useState(false);
  const [expandedByParentId, setExpandedByParentId] = useState({});

  const prevCurrentAgentIdRef = useRef(currentAgentId);
  useEffect(() => {
    if (prevCurrentAgentIdRef.current === currentAgentId) return;
    prevCurrentAgentIdRef.current = currentAgentId;
    if (currentAgentId == null) return;
    // If the user navigates to a nested subagent, ensure its ancestor toggles open.
    const toReveal = [];
    const collectAncestors = (nodes) => {
      for (const node of nodes) {
        if (node.children.length > 0 && nodeHasDescendantAgent(node, currentAgentId)) {
          toReveal.push(node.agent.id);
          collectAncestors(node.children);
        }
      }
    };
    collectAncestors([...builders, ...reviewers, ...orphans]);
    if (!toReveal.length) return;
    setExpandedByParentId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of toReveal) {
        if (next[id] === false) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentAgentId, builders, reviewers, orphans]);

  const totalTopLevel = builders.length + reviewers.length + orphans.length;
  if (!totalTopLevel) return null;

  const toggleParentExpanded = (parentId, nextExpanded) => {
    setExpandedByParentId((prev) => ({ ...prev, [parentId]: nextExpanded }));
  };

  const startRename = (agent) => {
    if (!isRenamableBuilder(agent)) return;
    setRenamingAgentId(agent.id);
    setRenameValue(agent.name?.trim() || agentDisplayTitle(agent));
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingAgentId(null);
    setRenameValue('');
  };

  const requestSetPrimary = (agent) => {
    if (!isSecondaryBuilder(agent)) return;
    setPendingPrimaryAgent(agent);
  };

  const confirmSetPrimary = async () => {
    if (!pendingPrimaryAgent?.id || setPrimarySaving) return;
    setSetPrimarySaving(true);
    try {
      await agentsService.setPrimary({ agent_id: pendingPrimaryAgent.id });
      setPendingPrimaryAgent(null);
      toast.success('Primary builder updated');
    } catch (err) {
      toastError('Failed to switch primary builder', err);
    } finally {
      setSetPrimarySaving(false);
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

  const nodeProps = {
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
    onRequestSetPrimary: requestSetPrimary,
    sessionHighlighted,
    expandedByParentId,
    onToggleParentExpanded: toggleParentExpanded,
  };

  const canShowAddBuilder = showAddBuilder && canManage && Boolean(onAddBuilder);

  return (
    <div className="mt-1.5 flex items-start gap-2">
      {pendingPrimaryAgent ? (
        <SetPrimaryConfirmModal
          agent={pendingPrimaryAgent}
          onConfirm={confirmSetPrimary}
          onCancel={() => {
            if (!setPrimarySaving) setPendingPrimaryAgent(null);
          }}
          loading={setPrimarySaving}
        />
      ) : null}
      <span className="w-3 shrink-0" aria-hidden />
      {showOwnerGutter && <span className="h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 max-h-72 overflow-y-auto" data-testid="session-agent-tree">
        {canShowAddBuilder && (
          <button
            type="button"
            data-testid="agent-tree-add-builder"
            aria-label="Add builder"
            onClick={(e) => {
              e.stopPropagation();
              onAddBuilder();
            }}
            className="mb-1 flex w-full items-center gap-1.5 rounded-md border border-dashed border-line/80 px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-fg-muted/50 hover:bg-control/50 hover:text-fg"
          >
            <Plus className="h-3 w-3 shrink-0" aria-hidden />
            <span>Add builder</span>
          </button>
        )}
        {builders.length > 0 && (
          <ul className="space-y-0.5">
            {builders.map((node) => (
              <AgentTreeNode key={node.agent.id} node={node} {...nodeProps} />
            ))}
          </ul>
        )}
        {reviewers.length > 0 && (
          <ul
            className={`space-y-0.5 ${
              builders.length > 0 ? 'mt-1 border-t border-line/50 pt-1' : ''
            }`}
          >
            {reviewers.map((node) => (
              <AgentTreeNode key={node.agent.id} node={node} {...nodeProps} />
            ))}
          </ul>
        )}
        {orphans.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {orphans.map((node) => (
              <AgentTreeNode key={node.agent.id} node={node} {...nodeProps} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ChevronDown, Loader2, Pencil } from 'lucide-react';
import AgentConfigLogo from './AgentConfigLogo.jsx';
import AgentTypeIcon from './AgentTypeIcon.jsx';
import Tooltip from './Tooltip.jsx';
import { SessionStatusIcon } from './SessionCard.jsx';
import { agentsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import { buildSessionAgentList } from '../utils/sessionAgentList.js';
import {
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
      className="shrink-0 p-0.5 rounded text-faint hover:text-fg md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
    >
      <Pencil className="w-3 h-3" aria-hidden />
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
      title={locked ? 'Open the primary agent to hide the others' : undefined}
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
 * Quiet pill behind the agent name: the primary builder gets brand, the
 * reviewer merged (same intensities as the composer switcher badges);
 * secondary builders and subagents stay plain.
 */
function agentNameToneClass(agent) {
  if (isPrimaryAgent(agent)) return 'bg-brand/15';
  if (isReviewerAgent(agent)) return 'bg-merged/10';
  return '';
}

function AgentTreeRow({ agent, ...rest }) {
  const { getConfig } = useAgentConfigContext();
  const config = getConfig(agent.agent_config_id);
  const title = agentDisplayTitle(agent);
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
        className={`group flex items-center gap-1.5 rounded-md py-1 pl-0 pr-1.5 transition-colors ${
          isCurrent ? 'bg-control-hover' : 'hover:bg-control/50'
        }`}
      >
        <AgentTreeIcon agent={agent} config={config} />
        <button
          type="button"
          onClick={() => onSelectAgent(agent)}
          title={isAgentTurnActive(agent.status) ? 'Turn running' : `Open ${title} chat`}
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
            <span
              className={`min-w-0 truncate rounded px-1 text-[11px] leading-4 inline-flex items-center gap-1 ${agentNameToneClass(
                agent
              )} ${isCurrent ? 'text-fg' : 'text-secondary'}`}
            >
              {isSubagentBuilder(agent) && (
                <span className="shrink-0" aria-hidden>
                  <AgentTypeIcon agentType="subagent" />
                </span>
              )}
              <span className="truncate">{title}</span>
            </span>
          )}
          <AgentTreeStatus status={agent.status} />
        </button>
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
            title={`Open ${title} chat`}
            aria-label={`Open ${title} chat`}
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
 * brand/merged tint (subagent rows stay plain). Rows show provider icon · name
 * · status · rename affordance · model (on the right). Subagent titles are
 * prefixed with the subagent type icon.
 */
export default function SessionAgentTree({
  agents,
  currentAgentId,
  canManage,
  onSelectAgent,
  autoExpanded = false,
  showOwnerGutter = false,
}) {
  const list = buildSessionAgentList(agents);
  const [renamingAgentId, setRenamingAgentId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  // null = follow the auto-expanded default; true/false = manual caret override.
  const [manuallyExpanded, setManuallyExpanded] = useState(null);

  if (!list.length) return null;

  const primary = list.find(isPrimaryAgent) ?? null;
  const others = primary ? list.filter((a) => a.id !== primary.id) : list;
  const grouped = Boolean(primary);
  const collapseLocked = isAgentTreeCollapseLocked(list, currentAgentId);
  const expanded = collapseLocked || (manuallyExpanded ?? autoExpanded);
  const caret =
    grouped && others.length > 0
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
  };

  const visibleAgents = [...(primary ? [primary] : []), ...(!grouped || expanded ? others : [])];

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

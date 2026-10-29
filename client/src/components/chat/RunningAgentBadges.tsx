import { AlertCircle, Loader2, Square } from 'lucide-react';
import AgentTypeIcon from '../AgentTypeIcon.jsx';
import Tooltip from '../Tooltip.jsx';
import {
  agentDisplayTitle,
  isAgentAwaitingUser,
  isAgentTurnActive,
  isSubagentBuilder,
} from '../../utils/sessionAgents.js';

export type RunningAgentBadge = {
  id: number;
  ref?: number;
  name?: string;
  agent_type?: string;
  status?: string;
};

function chipClass(agent, waiting) {
  if (waiting) {
    return isSubagentBuilder(agent)
      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
      : 'border-brand/50 bg-brand/15 text-accent';
  }
  return isSubagentBuilder(agent)
    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
    : 'border-brand/40 bg-brand/15 text-accent hover:bg-brand/25';
}

/**
 * Little badges above the composer for the session's other agents that are mid-turn
 * (detached subagents, extra builders). Click switches to that agent's chat; the
 * hover-revealed square stops its turn.
 */
export default function RunningAgentBadges({
  agents,
  onSelectAgent,
  onStopAgent,
  stoppingAgentId,
}: {
  agents?: RunningAgentBadge[];
  onSelectAgent?: (agent: RunningAgentBadge) => void;
  onStopAgent?: (agent: RunningAgentBadge) => void;
  stoppingAgentId?: number | null;
}) {
  if (!agents?.length) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="status"
      aria-label="Other agents running"
    >
      {agents.map((agent) => {
        const waiting = isAgentAwaitingUser(agent.status);
        const running = isAgentTurnActive(agent.status);
        const title = agentDisplayTitle(agent);
        const stopping = stoppingAgentId != null && stoppingAgentId === agent.id;
        return (
          <div
            key={agent.id}
            className={`group flex items-center gap-0.5 rounded-md border pr-0.5 text-xs font-medium transition-colors ${chipClass(
              agent,
              waiting
            )}`}
          >
            <button
              type="button"
              onClick={() => onSelectAgent?.(agent)}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left"
              title={`Switch to ${title}`}
            >
              <AgentTypeIcon agentType={agent.agent_type} subagent={isSubagentBuilder(agent)} />
              {agent.ref != null ? (
                <span className="font-mono text-[10px] opacity-70">#{agent.ref}</span>
              ) : null}
              <span className="max-w-[10rem] truncate">{title}</span>
              {running ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Tooltip content="Waiting for your input">
                  <AlertCircle
                    className="h-3 w-3 shrink-0 animate-pulse text-warning"
                    aria-hidden
                  />
                </Tooltip>
              )}
            </button>
            {onStopAgent && (running || waiting) && (
              <Tooltip content={`Stop ${title}`}>
                <button
                  type="button"
                  aria-label={`Stop ${title}`}
                  disabled={stoppingAgentId != null}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStopAgent(agent);
                  }}
                  className="rounded p-1 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40 dark:hover:bg-white/10"
                >
                  {stopping ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                  ) : (
                    <Square className="h-2.5 w-2.5 fill-current" aria-hidden />
                  )}
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}

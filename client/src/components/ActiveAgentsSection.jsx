import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useActiveAgents } from '../hooks/useActiveAgents.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import { parseModelField } from '../utils/models.js';
import { formatAgentSdkDisplayName } from '@baguette/shared/agent-sdk-display.js';
import { usageRepoLabel } from '../utils/usageSeries.js';
import { repoDisplayName } from '../utils/repoDisplayName.js';

const AGENT_TYPE_LABELS = { builder: 'Builder', reviewer: 'Reviewer' };

function modelAndParamsLabel(model, modelParams) {
  const id = parseModelField(model);
  if (!id && !modelParams) return '—';
  if (!modelParams) return id;
  if (!id) return modelParams;
  return `${id} · ${modelParams}`;
}

export default function ActiveAgentsSection({
  id = 'active-agents',
  userId = null,
  showUser = false,
}) {
  const { sessionUrl } = useFilterRoutes();
  const { agents, loading } = useActiveAgents({ userId });

  useEffect(() => {
    if (loading || window.location.hash !== `#${id}`) return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, id]);

  if (!loading && agents.length === 0) return null;

  return (
    <section
      id={id}
      className="rounded-xl border border-line bg-inset/50 overflow-hidden scroll-mt-20"
    >
      <div className="px-4 sm:px-6 py-3 border-b border-line flex items-center gap-2">
        <Bot className="w-4 h-4 text-accent motion-safe:animate-pulse shrink-0" aria-hidden />
        <h2 className="text-sm font-semibold text-heading">Active agents</h2>
        {!loading && (
          <span className="text-xs text-faint tabular-nums">{agents.length} running</span>
        )}
      </div>
      {loading ? (
        <p className="px-4 sm:px-6 py-6 text-sm text-faint">Loading active agents…</p>
      ) : (
        <ul className="divide-y divide-line/80">
          {agents.map((agent) => {
            const sessionTitle = agent.label || `Session ${agent.short_id}`;
            const repoLabel = agent.repo_full_name
              ? repoDisplayName(agent.repo_full_name)
              : usageRepoLabel(agent.repo_full_name);
            const modelLine = modelAndParamsLabel(agent.model, agent.model_params);

            return (
              <li key={`${agent.session_id}-${agent.agent_type}`}>
                <Link
                  to={sessionUrl(agent.short_id)}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3 hover:bg-control/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-heading truncate">{sessionTitle}</div>
                    <div className="text-xs text-faint truncate mt-0.5">
                      {showUser && agent.username ? <span>{agent.username} · </span> : null}
                      {repoLabel}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs shrink-0 sm:justify-end sm:text-right">
                    <span className="text-fg-muted">
                      {AGENT_TYPE_LABELS[agent.agent_type] ?? agent.agent_type}
                    </span>
                    <span className="text-faint">
                      {agent.agent_sdk ? formatAgentSdkDisplayName(agent.agent_sdk) : '—'}
                    </span>
                    <span
                      className="text-fg-muted font-mono truncate max-w-[14rem] sm:max-w-md"
                      title={modelLine}
                    >
                      {modelLine}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

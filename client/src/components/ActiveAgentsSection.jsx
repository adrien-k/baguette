import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { useActiveAgents } from '../hooks/useActiveAgents.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import { usageRepoLabel } from '../utils/usageSeries.js';
import { repoDisplayName } from '../utils/repoDisplayName.js';
import AgentTurnModelLabel from './AgentTurnModelLabel.jsx';

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
            const sessionTitle = agent.label || `Session #${agent.session_id}`;
            const repoLabel = agent.repo_full_name
              ? repoDisplayName(agent.repo_full_name)
              : usageRepoLabel(agent.repo_full_name);

            return (
              <li key={`${agent.session_id}-${agent.agent_type}`}>
                <Link
                  to={sessionUrl(agent.session_id)}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3 hover:bg-control/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-heading truncate">{sessionTitle}</div>
                    <div className="text-xs text-faint truncate mt-0.5">
                      {showUser && agent.username ? <span>{agent.username} · </span> : null}
                      {repoLabel}
                    </div>
                  </div>
                  <div className="sm:justify-end sm:text-right">
                    <AgentTurnModelLabel
                      agentType={agent.agent_type}
                      agentConfigId={agent.agent_config_id}
                      model={agent.model}
                      modelParams={agent.model_params}
                    />
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

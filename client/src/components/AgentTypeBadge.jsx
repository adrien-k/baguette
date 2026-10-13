import { agentTypeLabel } from '../utils/sessionAgents.js';

export default function AgentTypeBadge({ agentType, className = '' }) {
  if (!agentType) return null;
  const label = agentTypeLabel(agentType);
  const tone =
    agentType === 'reviewer' ? 'bg-violet-500/15 text-violet-300' : 'bg-brand/15 text-accent';
  return (
    <span
      className={`shrink-0 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${tone} ${className}`}
    >
      {label}
    </span>
  );
}

import { Bot, ClipboardCheck, Network } from 'lucide-react';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

/** Small icon distinguishing builder vs reviewer vs subagent. */
export default function AgentTypeIcon({ agentType, subagent = false, className = '' }) {
  if (agentType === 'reviewer') {
    return (
      <ClipboardCheck className={`${ICON_CLASS} text-violet-300 ${className}`} strokeWidth={2} />
    );
  }
  if (agentType === 'subagent' || subagent) {
    return <Network className={`${ICON_CLASS} text-cyan-300 ${className}`} strokeWidth={2} />;
  }
  return <Bot className={`${ICON_CLASS} text-accent ${className}`} strokeWidth={2} />;
}

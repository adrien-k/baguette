import { Bot, ClipboardCheck } from 'lucide-react';

const ICON_CLASS = 'w-3.5 h-3.5 shrink-0';

/** Small icon distinguishing builder vs reviewer agents. */
export default function AgentTypeIcon({ agentType, className = '' }) {
  if (agentType === 'reviewer') {
    return (
      <ClipboardCheck className={`${ICON_CLASS} text-violet-300 ${className}`} strokeWidth={2} />
    );
  }
  return <Bot className={`${ICON_CLASS} text-accent ${className}`} strokeWidth={2} />;
}

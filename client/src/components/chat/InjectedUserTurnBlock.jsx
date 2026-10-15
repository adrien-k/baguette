import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import MessageTurnModelBadge from './MessageTurnModelBadge.jsx';

/** Collapsed Baguette- or loop-injected user turn (shared accent styling). */
export default function InjectedUserTurnBlock({ label, defaultTitle, message, agentType }) {
  const [expanded, setExpanded] = useState(false);
  const title = message.title || defaultTitle;
  const content = typeof message.content === 'string' ? message.content : '';

  return (
    <div className="ml-4 sm:ml-8 bg-soft-accent/20 rounded-lg border border-brand/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-brand/10 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-accent text-xs font-medium shrink-0">{label}</span>
          <span className="text-fg-muted text-xs truncate min-w-0">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <MessageTurnModelBadge
            agentType={agentType}
            model={message.model}
            modelParams={message.model_params}
            agentConfigId={message.agent_config_id}
          />
          <ChevronDown
            className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-brand/30 text-xs text-fg-muted whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

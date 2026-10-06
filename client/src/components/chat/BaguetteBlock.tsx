import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { messageModelLabel } from '../../utils/messageModelLabel.js';

/**
 * A `user` message Baguette wrote on the session's behalf — typed rows carry a
 * flat `content` string.
 */
export default function BaguetteBlock({
  message,
  models = [],
  session,
}: {
  message: {
    title?: string | null;
    content?: string;
    created_at?: string | null;
    model?: string | null;
    model_params?: unknown;
  };
  models?: { id?: string; label?: string; name?: string }[];
  session?: { model?: string | null; model_params?: unknown } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = message.title || 'Baguette';
  const turnModelLabel = messageModelLabel({
    model: message.model ?? session?.model,
    modelParams: message.model_params ?? session?.model_params,
    models,
  });
  const content = typeof message.content === 'string' ? message.content : '';

  return (
    <div className="ml-4 sm:ml-8 bg-soft-accent/20 rounded-lg border border-brand/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-brand/10 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-accent text-xs font-medium shrink-0">Baguette</span>
          <span className="text-fg-muted text-xs truncate min-w-0">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          {turnModelLabel ? (
            <span className="text-faint text-xs font-normal truncate max-w-[12rem] sm:max-w-xs text-right">
              {turnModelLabel}
            </span>
          ) : null}
          <ChevronDown
            className={`w-4 h-4 text-faint shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
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

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export default function BaguetteBlock({ message }) {
  const [expanded, setExpanded] = useState(false);
  const title = message.title || 'Baguette';
  const content =
    typeof message.message?.content === 'string'
      ? message.message.content
      : JSON.stringify(message.message?.content);

  return (
    <div className="ml-4 sm:ml-8 bg-amber-950/20 rounded-lg border border-amber-900/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-amber-900/10 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-500 text-xs font-medium shrink-0">Baguette</span>
          <span className="text-zinc-400 text-xs truncate">{title}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-amber-900/30 text-xs text-zinc-400 whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

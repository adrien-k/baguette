import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { formatTurnErrorMessage } from '@baguette/shared/format-turn-error-message.js';

type TurnErrorMessageProps = {
  errorMessage: string;
  className?: string;
};

export default function TurnErrorMessage({ errorMessage, className = '' }: TurnErrorMessageProps) {
  const { headline, detail, raw } = formatTurnErrorMessage(errorMessage);
  const [open, setOpen] = useState(false);
  const showDetails = raw !== headline || Boolean(detail);

  return (
    <div
      className={`max-w-lg w-full rounded-lg border border-danger/40 bg-nav px-3 py-2.5 text-left ${className}`}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-danger leading-snug">{headline}</p>
          {detail && <p className="mt-1 text-xs text-fg-muted leading-relaxed">{detail}</p>}
          {showDetails && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="mt-1.5 flex items-center gap-1 text-xs text-faint hover:text-secondary transition-colors"
            >
              {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {open ? 'Hide details' : 'Show details'}
            </button>
          )}
          {open && (
            <pre className="mt-2 text-xs text-fg-muted bg-control border border-strong rounded px-2 py-1.5 overflow-auto max-h-32 whitespace-pre-wrap break-words">
              {raw}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

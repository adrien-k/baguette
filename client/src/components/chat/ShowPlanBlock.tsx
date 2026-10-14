import { useState } from 'react';
import CollapsibleMarkdown from './CollapsibleMarkdown.tsx';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

export default function ShowPlanBlock({
  heading = 'Plan ready for review',
  markdown,
  sessionId,
  userReplied = false,
  isRunning = false,
  isError = false,
  errorMessage = null,
}: {
  heading?: string;
  markdown?: string | null;
  sessionId?: number | null;
  userReplied?: boolean;
  isRunning?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
}) {
  const [loading, setLoading] = useState(false);

  const sendUserMessage = async (text: string) => {
    if (sessionId == null) return;
    setLoading(true);
    try {
      await sessionsService.createDefaultBuilderMessage({
        id: sessionId,
        content: text,
      });
    } catch (err) {
      toastError('Failed to send message', err);
      setLoading(false);
    }
  };

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isError ? 'border-danger/60 bg-red-950/10' : 'border-brand/20 bg-soft-accent/10'
      }`}
    >
      <div
        className={`px-3 sm:px-4 py-2 border-b flex items-center gap-2 ${
          isError ? 'border-danger/30' : 'border-brand/10'
        }`}
      >
        <p className={`text-xs ${isError ? 'text-danger' : 'text-accent/70'}`}>{heading}</p>
        {isError && <span className="text-danger text-xs font-medium">error</span>}
        {isRunning && (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        )}
      </div>
      <div className="px-3 sm:px-4 py-3 overflow-auto max-h-[50vh] text-sm">
        {isError && errorMessage ? (
          <p className="text-sm text-danger">{errorMessage}</p>
        ) : markdown?.trim() ? (
          <CollapsibleMarkdown previewLines={12} simpleToggle>
            {markdown}
          </CollapsibleMarkdown>
        ) : (
          <p className="text-sm text-faint italic">No plan content yet.</p>
        )}
      </div>
      {!userReplied && !isError && (
        <div className="px-3 sm:px-4 pb-4 pt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => sendUserMessage('Proceed with the plan.')}
            disabled={loading}
            className={SECONDARY_BUTTON_CLASS}
          >
            Run the plan
          </button>
          <button
            type="button"
            onClick={() => sendUserMessage('Please refine the plan.')}
            disabled={loading}
            className={SECONDARY_BUTTON_CLASS}
          >
            Refine the plan
          </button>
        </div>
      )}
    </div>
  );
}

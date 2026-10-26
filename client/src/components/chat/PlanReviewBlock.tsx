import { useState } from 'react';
import MarkdownContent from '../MarkdownContent.jsx';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

export default function PlanReviewBlock({
  markdown,
  sessionId,
  agentId,
  userReplied = false,
}: {
  markdown?: string | null;
  sessionId?: number | null;
  agentId?: number | null;
  userReplied?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const handleRun = async () => {
    if (sessionId == null) return;
    setLoading(true);
    try {
      await sessionsService.createDefaultBuilderMessage({
        id: sessionId,
        content: 'Proceed with the plan.',
        ...(agentId != null ? { agent_id: agentId } : {}),
      });
    } catch (err) {
      toastError('Failed to run plan', err);
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-brand/20 bg-soft-accent/10 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 border-b border-brand/10">
        <p className="text-xs text-accent/70">Plan ready for review</p>
      </div>
      <div className="px-3 sm:px-4 py-3 overflow-auto max-h-[50vh]">
        {markdown?.trim() ? (
          <MarkdownContent>{markdown}</MarkdownContent>
        ) : (
          <p className="text-sm text-faint italic">No plan content.</p>
        )}
      </div>
      {!userReplied && (
        <div className="px-3 sm:px-4 pb-4 pt-1 space-y-2">
          <button
            type="button"
            onClick={handleRun}
            disabled={loading}
            className={SECONDARY_BUTTON_CLASS}
          >
            Run the plan
          </button>
          <p className="text-xs text-faint">
            or continue chatting with the agent to refine the plan
          </p>
        </div>
      )}
    </div>
  );
}

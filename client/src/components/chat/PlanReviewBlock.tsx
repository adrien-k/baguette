import { useState } from 'react';
import MarkdownContent from '../MarkdownContent.jsx';
import { messagesService, sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { builderMessageCreateFields } from '../../utils/messageCreateFields.js';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

export default function PlanReviewBlock({
  markdown,
  sessionId,
  session,
  userReplied = false,
}: {
  markdown?: string | null;
  sessionId?: number | null;
  session?: { agent_sdk?: string | null; model?: string | null; model_params?: unknown } | null;
  userReplied?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const handleRun = async () => {
    if (sessionId == null) return;
    setLoading(true);
    try {
      await sessionsService.patch(sessionId, { plan_mode: false });
      await messagesService.create({
        session_id: sessionId,
        type: 'user',
        message_json: JSON.stringify({ type: 'user', content: 'Proceed with the plan.' }),
        ...builderMessageCreateFields(session ?? {}),
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

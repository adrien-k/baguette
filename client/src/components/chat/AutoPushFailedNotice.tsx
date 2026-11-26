import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

export function buildAutoPushFixMessage(error?: string | null): string {
  const trimmed = error?.trim();
  if (trimmed) {
    return `Auto-push failed (${trimmed}). Please fix the issue and push the changes again.`;
  }
  return 'Auto-push failed. Please fix the issue and push the changes again.';
}

/**
 * Notice shown in chat when an automated post-turn push fails, with a button
 * to ask the agent to resolve the issue and push again.
 */
export default function AutoPushFailedNotice({
  error,
  conflict = false,
  sessionId,
  agentId,
  userReplied = false,
  readonly = false,
}: {
  error?: string | null;
  conflict?: boolean;
  sessionId?: number | null;
  agentId?: number | null;
  userReplied?: boolean;
  readonly?: boolean;
}) {
  const [sending, setSending] = useState(false);

  const heading = conflict ? 'Auto-push failed due to a conflict' : 'Auto-push failed';
  const showButton = !userReplied && !readonly && sessionId != null;

  const handleAskAgent = async () => {
    if (sessionId == null || sending || userReplied || readonly) return;
    setSending(true);
    try {
      await sessionsService.createDefaultBuilderMessage({
        id: sessionId,
        content: buildAutoPushFixMessage(error),
        ...(agentId != null ? { agent_id: agentId } : {}),
      });
    } catch (err) {
      toastError('Failed to send message', err);
      setSending(false);
    }
  };

  return (
    <div className="flex justify-center px-2">
      <div
        role="alert"
        className="max-w-lg w-full rounded-lg border border-danger/40 bg-nav px-3 py-2.5 text-left"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium text-danger leading-snug">{heading}</p>
            {error && <p className="text-xs text-fg-muted leading-relaxed break-words">{error}</p>}
            <p className="text-xs text-secondary leading-relaxed">
              Ask the agent to resolve the issue and push again.
            </p>
            {showButton && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleAskAgent}
                  disabled={sending}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  {sending ? 'Sending…' : 'Ask agent to fix & push'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

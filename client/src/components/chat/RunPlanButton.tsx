import { useState } from 'react';
import { runPlanUserMessage } from '../../utils/sessionPlanRun.js';
import { sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import { SECONDARY_BUTTON_CLASS } from '../../utils/buttonStyles.js';

export default function RunPlanButton({
  sessionId,
  agentId,
  planRef,
  disabled = false,
  className = SECONDARY_BUTTON_CLASS,
}: {
  sessionId?: number | null;
  agentId?: number | null;
  planRef?: number | null;
  disabled?: boolean;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleRun = async () => {
    if (sessionId == null || loading || disabled) return;
    setLoading(true);
    try {
      await sessionsService.createDefaultBuilderMessage({
        id: sessionId,
        content: runPlanUserMessage(planRef ?? undefined),
        ...(agentId != null ? { agent_id: agentId } : {}),
      });
    } catch (err) {
      toastError('Failed to run plan', err);
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleRun}
      disabled={disabled || loading || sessionId == null}
      className={className}
    >
      Run the plan
    </button>
  );
}

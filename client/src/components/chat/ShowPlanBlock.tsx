import CollapsibleMarkdown from './CollapsibleMarkdown.tsx';
import RunPlanButton from './RunPlanButton.tsx';

export default function ShowPlanBlock({
  heading = 'Plan ready for review',
  markdown,
  sessionId,
  agentId,
  interactive = true,
  isRunning = false,
  isError = false,
  errorMessage = null,
}: {
  heading?: string;
  markdown?: string | null;
  sessionId?: number | null;
  agentId?: number | null;
  /** When false (agent passed interactive: false), plan is informational — no Run action. */
  interactive?: boolean;
  isRunning?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
}) {
  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isError ? 'border-danger/60 bg-soft-danger/50' : 'border-brand/20 bg-soft-accent/10'
      }`}
    >
      <div
        className={`px-3 sm:px-4 py-2 border-b flex items-center gap-2 ${
          isError ? 'border-danger/30' : 'border-brand/10'
        }`}
      >
        <p className={`text-xs ${isError ? 'text-danger' : 'text-accent'}`}>{heading}</p>
        {isError && <span className="text-danger text-xs font-medium">error</span>}
        {isRunning && (
          <div className="w-3 h-3 border border-strong border-t-zinc-400 rounded-full animate-spin shrink-0" />
        )}
      </div>
      <div className="px-3 sm:px-4 py-3 text-sm">
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
      {interactive && !isError && (
        <div className="px-3 sm:px-4 pb-4 pt-1 space-y-2">
          <RunPlanButton sessionId={sessionId} agentId={agentId} />
          <p className="text-xs text-faint">
            or continue chatting with the agent to refine the plan
          </p>
        </div>
      )}
    </div>
  );
}

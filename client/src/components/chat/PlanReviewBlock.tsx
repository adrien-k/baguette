import MarkdownContent from '../MarkdownContent.jsx';
import RunPlanButton from './RunPlanButton.tsx';

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
  return (
    <div className="rounded-lg border border-brand/20 bg-soft-accent/10 overflow-hidden">
      <div className="px-3 sm:px-4 py-2 border-b border-brand/10">
        <p className="text-xs text-accent">Plan ready for review</p>
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
          <RunPlanButton sessionId={sessionId} agentId={agentId} />
          <p className="text-xs text-faint">
            or continue chatting with the agent to refine the plan
          </p>
        </div>
      )}
    </div>
  );
}

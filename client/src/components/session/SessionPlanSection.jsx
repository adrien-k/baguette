import { CheckCircle } from 'lucide-react';
import CollapsibleMarkdown from '../chat/CollapsibleMarkdown.tsx';
import RunPlanButton from '../chat/RunPlanButton.tsx';
import SessionTodosPanel from './SessionTodosPanel.jsx';
import PlanStatusBadge from './PlanStatusBadge.jsx';
import { NEUTRAL_BUTTON_CLASS } from '../../utils/buttonStyles.js';
import { sessionPlanTitle } from '../../utils/sessionPlanDisplay.ts';

export default function SessionPlanSection({
  plan,
  todos,
  sessionId,
  runPlanAgentId,
  editable = false,
  completing = false,
  onComplete,
}) {
  const markdown = (plan.markdown ?? '').trim();
  const isCompleted = plan.status === 'completed';
  const refLabel = plan.ref != null ? `#${plan.ref}` : null;
  const title = sessionPlanTitle(plan);

  return (
    <section
      id={plan.ref != null ? `plan-${plan.ref}` : undefined}
      className={`space-y-4 rounded-xl border p-3 sm:p-4 scroll-mt-4 ${
        isCompleted ? 'border-line bg-inset/20 opacity-90' : 'border-line bg-inset/30'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-heading">
          {title}
          {refLabel ? <span className="text-faint font-normal">{` ${refLabel}`}</span> : null}
        </h2>
        <PlanStatusBadge status={plan.status} />
        {editable && !isCompleted && (
          <button
            type="button"
            onClick={() => onComplete?.(plan)}
            disabled={completing}
            className={`${NEUTRAL_BUTTON_CLASS} ml-auto`}
          >
            <CheckCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {completing ? 'Completing…' : 'Mark completed'}
          </button>
        )}
      </div>
      {markdown ? (
        <CollapsibleMarkdown previewLines={12} simpleToggle>
          {markdown}
        </CollapsibleMarkdown>
      ) : (
        <p className="text-sm text-faint">No plan content yet.</p>
      )}
      {editable && !isCompleted && (
        <div className="space-y-2">
          <RunPlanButton sessionId={sessionId} agentId={runPlanAgentId} planRef={plan.ref} />
          <p className="text-xs text-faint">
            or continue chatting with the agent to refine the plan
          </p>
        </div>
      )}
      <div className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint">Todos</h3>
        <SessionTodosPanel
          sessionId={sessionId}
          editable={editable}
          planId={plan.id}
          todos={todos}
          emptyMessage="No todos for this plan."
        />
      </div>
    </section>
  );
}

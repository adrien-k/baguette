import { CheckCircle } from 'lucide-react';
import CollapsibleMarkdown from '../chat/CollapsibleMarkdown.tsx';
import SessionTodosPanel from './SessionTodosPanel.jsx';
import { NEUTRAL_BUTTON_CLASS } from '../../utils/buttonStyles.js';

const PLAN_STATUS_BADGE_CLASS = {
  open: 'bg-brand/15 text-accent border-brand/35',
  completed: 'bg-success/15 text-success border-success/35',
};

function PlanStatusBadge({ status = 'open' }) {
  const key = status === 'completed' ? 'completed' : 'open';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PLAN_STATUS_BADGE_CLASS[key]}`}
    >
      {key}
    </span>
  );
}

export default function SessionPlanSection({
  plan,
  todos,
  sessionId,
  editable = false,
  completing = false,
  onComplete,
}) {
  const markdown = (plan.markdown ?? '').trim();
  const isCompleted = plan.status === 'completed';
  const refLabel = plan.ref != null ? `#${plan.ref}` : null;

  return (
    <section
      className={`space-y-4 rounded-xl border p-3 sm:p-4 ${
        isCompleted ? 'border-line bg-inset/20 opacity-90' : 'border-line bg-inset/30'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-heading">Plan{refLabel ? ` ${refLabel}` : ''}</h2>
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

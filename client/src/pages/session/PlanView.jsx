import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import SessionPlanSection from '../../components/session/SessionPlanSection.jsx';
import SessionTodosPanel from '../../components/session/SessionTodosPanel.jsx';
import { sessionPlansService } from '../../feathers.js';
import { useGetSessionPlans } from '../../hooks/useGetSessionPlans.js';
import { useGetSessionTodos } from '../../hooks/useGetSessionTodos.js';
import { toastError } from '../../utils/toastError.jsx';

const SECTION_HEADING_CLASS = 'text-xs font-medium text-faint uppercase tracking-wide';
const EMPTY_TODOS = [];

function comparePlans(a, b) {
  const refA = a.ref ?? Number.MAX_SAFE_INTEGER;
  const refB = b.ref ?? Number.MAX_SAFE_INTEGER;
  if (refA !== refB) return refA - refB;
  return (a.id ?? 0) - (b.id ?? 0);
}

export default function PlanView({ session, readonly = false }) {
  const sessionId = session?.id;
  const editable = !readonly;
  const [completingId, setCompletingId] = useState(null);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  const { plans, loading: plansLoading } = useGetSessionPlans(sessionId, {
    enabled: sessionId != null,
  });
  const { todos, loading: todosLoading } = useGetSessionTodos(sessionId, {
    enabled: sessionId != null,
    openOnly: false,
  });

  const { openPlans, completedPlans, unattachedTodos, todosByPlanId } = useMemo(() => {
    const open = [];
    const completed = [];
    for (const plan of plans) {
      if (plan.status === 'completed') completed.push(plan);
      else open.push(plan);
    }
    open.sort(comparePlans);
    completed.sort(comparePlans);

    const byPlan = new Map();
    for (const plan of plans) {
      byPlan.set(plan.id, []);
    }
    const unattached = [];
    for (const todo of todos) {
      const grouped = byPlan.get(todo.plan_id);
      if (grouped) {
        grouped.push(todo);
        continue;
      }
      unattached.push(todo);
    }
    return {
      openPlans: open,
      completedPlans: completed,
      unattachedTodos: unattached,
      todosByPlanId: byPlan,
    };
  }, [plans, todos]);

  const handleComplete = async (plan) => {
    if (plan.id == null) return;
    const label = plan.ref != null ? `#${plan.ref}` : 'this plan';
    if (!window.confirm(`Mark plan ${label} as completed?`)) return;
    setCompletingId(plan.id);
    try {
      await sessionPlansService.patch(plan.id, { status: 'completed' });
    } catch (err) {
      toastError('Failed to complete plan', err);
    } finally {
      setCompletingId(null);
    }
  };

  const renderPlan = (plan) => (
    <SessionPlanSection
      key={plan.id ?? plan.ref}
      plan={plan}
      todos={todosByPlanId.get(plan.id) ?? EMPTY_TODOS}
      sessionId={sessionId}
      editable={editable}
      completing={completingId === plan.id}
      onComplete={handleComplete}
    />
  );

  if (plansLoading || todosLoading) {
    return (
      <div className="flex-1 overflow-auto p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <p className="text-sm text-faint">Loading…</p>
      </div>
    );
  }

  const hasPlans = openPlans.length > 0 || completedPlans.length > 0;
  const showUnattached = unattachedTodos.length > 0 || editable;
  const showCompletedToggle = completedPlans.length > 0;

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-8">
      {!hasPlans && <p className="text-sm text-faint">No plan yet.</p>}
      {openPlans.map(renderPlan)}

      {showUnattached && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-heading">Unattached</h2>
          <SessionTodosPanel
            sessionId={sessionId}
            editable={editable}
            todos={unattachedTodos}
            emptyMessage="No unattached todos."
          />
        </section>
      )}

      {showCompletedToggle && (
        <section
          className={`space-y-4 ${
            openPlans.length > 0 || showUnattached ? 'border-t border-line pt-4' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => setCompletedExpanded((prev) => !prev)}
            className={`${SECTION_HEADING_CLASS} flex w-full items-center gap-1.5 text-left hover:text-secondary`}
          >
            {completedExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            Completed ({completedPlans.length})
          </button>
          {completedExpanded && completedPlans.map(renderPlan)}
        </section>
      )}
    </div>
  );
}

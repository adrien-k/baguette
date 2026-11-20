import { Link, useParams } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { useGetSessionPlans } from '../../hooks/useGetSessionPlans.js';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';
import PlanStatusBadge from '../session/PlanStatusBadge.jsx';
import { sessionPlanTitle } from '../../utils/sessionPlanDisplay.ts';

export default function ChatSessionPlanLinks({ sessionId }: { sessionId?: number | null }) {
  const { id: sessionRouteId } = useParams();
  const { sessionUrl } = useFilterRoutes();
  const { plans, loading } = useGetSessionPlans(sessionId, { enabled: sessionId != null });

  const openPlans = plans.filter((p) => p.status !== 'completed');
  if (loading || openPlans.length === 0 || sessionRouteId == null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-xs text-faint">
      <span className="inline-flex items-center gap-1.5 shrink-0 text-secondary">
        <ListTodo className="w-3.5 h-3.5 text-accent/80 shrink-0" aria-hidden />
        Plans
      </span>
      {openPlans.map((plan) => {
        const ref = plan.ref;
        const title = sessionPlanTitle(plan);
        const hash = ref != null ? `#plan-${ref}` : '';
        const to = `${sessionUrl(sessionRouteId)}?view=plan${hash}`;
        return (
          <Link
            key={plan.id ?? ref ?? title}
            to={to}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line/80 bg-inset/30 px-2 py-1 text-secondary transition-colors hover:border-line hover:bg-inset/50"
          >
            <span className="min-w-0 truncate font-medium text-accent">{title}</span>
            <PlanStatusBadge status={plan.status} />
          </Link>
        );
      })}
    </div>
  );
}

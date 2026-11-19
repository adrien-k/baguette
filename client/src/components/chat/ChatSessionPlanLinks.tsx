import { Link, useParams } from 'react-router-dom';
import { ListTodo } from 'lucide-react';
import { useGetSessionPlans } from '../../hooks/useGetSessionPlans.js';
import { useFilterRoutes } from '../../hooks/useFilterRoutes.js';

export default function ChatSessionPlanLinks({ sessionId }: { sessionId?: number | null }) {
  const { short_id } = useParams();
  const { sessionUrl } = useFilterRoutes();
  const { plans, loading } = useGetSessionPlans(sessionId, { enabled: sessionId != null });

  const openPlans = plans.filter((p) => p.status !== 'completed');
  if (loading || openPlans.length === 0 || short_id == null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs text-faint">
      <span className="inline-flex items-center gap-1.5 shrink-0 text-secondary">
        <ListTodo className="w-3.5 h-3.5 text-accent/80 shrink-0" aria-hidden />
        Plans
      </span>
      {openPlans.map((plan) => {
        const ref = plan.ref;
        const label = ref != null ? `Plan #${ref}` : 'Plan';
        const hash = ref != null ? `#plan-${ref}` : '';
        const to = `${sessionUrl(short_id)}?view=plan${hash}`;
        return (
          <Link key={plan.id ?? ref ?? label} to={to} className="text-accent hover:underline">
            {label}
          </Link>
        );
      })}
    </div>
  );
}

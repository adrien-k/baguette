const PLAN_STATUS_BADGE_CLASS = {
  open: 'bg-brand/15 text-accent border-brand/35',
  completed: 'bg-success/15 text-success border-success/35',
};

export default function PlanStatusBadge({ status = 'open' }) {
  const key = status === 'completed' ? 'completed' : 'open';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PLAN_STATUS_BADGE_CLASS[key]}`}
    >
      {key}
    </span>
  );
}

import { ClipboardCheck } from 'lucide-react';

export function isReviewInProgress(session) {
  return !!session && !session.archived_at && session.review_status === 'running';
}

const BADGE =
  'inline-flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand/10 text-accent/90 border border-brand/20';

/** Label shown on dashboard cards and the session sidebar when a review agent is running. */
export default function ReviewInProgressBadge({ compact = false }) {
  if (compact) {
    return (
      <span className="shrink-0 text-[10px] text-accent/90" title="Review in progress">
        Reviewing…
      </span>
    );
  }

  return (
    <span className={BADGE} title="Review in progress">
      <ClipboardCheck className="w-3 h-3 motion-safe:animate-pulse" aria-hidden />
      Reviewing…
    </span>
  );
}

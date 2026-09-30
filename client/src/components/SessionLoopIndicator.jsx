import { Link } from 'react-router-dom';
import { Repeat } from 'lucide-react';

const LOOP_TITLE = 'Started by a loop';

/** Shared secondary styling for loop-spawned sessions (sidebar icon + dashboard badge). */
export const SESSION_LOOP_ICON_CLASS = 'w-3 h-3 shrink-0 text-secondary';

export function SessionLoopIcon({ className = '' }) {
  return (
    <Repeat
      className={`${SESSION_LOOP_ICON_CLASS} ${className}`.trim()}
      aria-hidden
      title={LOOP_TITLE}
    />
  );
}

const BADGE_CLASS =
  'inline-flex items-center gap-1 shrink-0 rounded border border-strong px-1.5 py-0.5 text-[10px] font-medium text-secondary';

/** Session list / header badge for loop-spawned sessions. Pass `to` to link to the loop edit page. */
export function SessionLoopBadge({ to }) {
  const className = to
    ? `${BADGE_CLASS} hover:bg-control/80 hover:border-faint transition-colors`
    : BADGE_CLASS;
  const title = to ? 'View loop' : LOOP_TITLE;
  const content = (
    <>
      <SessionLoopIcon />
      Loop
    </>
  );
  if (to) {
    return (
      <Link to={to} title={title} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <span title={title} className={className}>
      {content}
    </span>
  );
}

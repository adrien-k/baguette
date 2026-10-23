import { Link } from 'react-router-dom';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import CardRepoBadge from './CardRepoBadge.jsx';
import ArchiveSession from './ArchiveSession.jsx';
import StopSession, { isSessionStoppable } from './StopSession.jsx';
import SessionListIndicator, { SessionUnreadDot } from './SessionListIndicator.jsx';
import ReviewInProgressBadge, { isReviewInProgress } from './ReviewInProgressBadge.jsx';
import { SessionLoopIcon } from './SessionLoopIndicator.jsx';
import { sessionListPromptPreview } from '../pages/session/sessionListDisplay.js';

export default function MiniSessionEntry({
  session: s,
  currentId,
  onArchive,
  hideRepoBadge = false,
  suppressUnreadWhenOpen = false,
}) {
  const isArchived = !!s.archived_at;
  const isArchiving = !isArchived && s.status === 'archiving';
  const { sessionUrl, showRepoDetails } = useFilterRoutes();
  const isCurrent = String(s.id) === String(currentId);
  const title = s.label || (isGlobalSession(s) ? 'Global session' : s.repo_full_name) || 'Session';
  const promptPreview = sessionListPromptPreview(s);
  const showRepo = showRepoDetails && !hideRepoBadge;

  return (
    <div
      className={`group px-3 py-2 text-xs transition-colors ${
        isArchived || isArchiving ? 'opacity-50' : ''
      } ${isCurrent ? 'bg-control-hover' : 'hover:bg-control/50'}`}
    >
      <div className="flex items-center gap-2">
        <SessionListIndicator session={s} />
        <Link to={sessionUrl(s.id)} className="flex-1 min-w-0 leading-snug text-left">
          {showRepo && (
            <span className="block truncate">
              <CardRepoBadge show isGlobal={isGlobalSession(s)} repoFullName={s.repo_full_name} />
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1.5">
            <SessionUnreadDot session={s} suppressUnread={suppressUnreadWhenOpen} />
            <span
              className={`min-w-0 truncate font-medium ${isCurrent ? 'text-fg' : 'text-heading'}`}
            >
              {title}
            </span>
            {s.loop_id && <SessionLoopIcon />}
            {isReviewInProgress(s) && !isArchiving && <ReviewInProgressBadge compact />}
          </span>
          {promptPreview && (
            <span className="block truncate text-[11px] text-faint">{promptPreview}</span>
          )}
        </Link>
        {isArchiving && <span className="shrink-0 text-[10px] text-accent/90">Archiving…</span>}
        {!s.archived_at && !isArchiving && (
          <div className="shrink-0">
            {isSessionStoppable(s) ? (
              <StopSession session={s} />
            ) : (
              <ArchiveSession session={s} onArchive={() => onArchive?.(s)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

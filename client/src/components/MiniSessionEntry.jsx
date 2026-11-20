import { Link, useNavigate } from 'react-router-dom';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import CardRepoBadge from './CardRepoBadge.jsx';
import ArchiveSession from './ArchiveSession.jsx';
import StopSession, { isSessionStoppable } from './StopSession.jsx';
import SessionAgentTree from './SessionAgentTree.jsx';
import SessionListIndicator, { SessionUnreadDot } from './SessionListIndicator.jsx';
import ReviewInProgressBadge, { isReviewInProgress } from './ReviewInProgressBadge.jsx';
import { SessionLoopIcon } from './SessionLoopIndicator.jsx';
import { sessionListPromptPreview } from '../pages/session/sessionListDisplay.js';
import { useCurrentUser } from '../context/CurrentUserContext.jsx';
import { formatCompactRelativeTime } from '../utils/dates.js';
import { LIST_SCOPE_SHARED, isSessionOwner } from '@baguette/shared/session-sharing.js';
import ListOwnerLabel from './ListOwnerLabel.jsx';

export default function MiniSessionEntry({
  session: s,
  currentId,
  onArchive,
  hideRepoBadge = false,
  suppressUnreadWhenOpen = false,
  listScope,
  routeAgentId = null,
  autoExpandId = null,
  isMobileList = false,
  onAddBuilder = null,
  showAddBuilder = false,
}) {
  const navigate = useNavigate();
  const { currentUser } = useCurrentUser();
  const isOwner = isSessionOwner(s, currentUser);
  const showOwner = listScope === LIST_SCOPE_SHARED || !isOwner;
  const isArchived = !!s.archived_at;
  const isArchiving = !isArchived && s.status === 'archiving';
  const { sessionUrl, showRepoDetails } = useFilterRoutes();
  const isCurrent = String(s.id) === String(currentId);
  const rowHighlighted = isCurrent;
  const promptPreview = sessionListPromptPreview(s);
  const title =
    s.label?.trim() ||
    promptPreview ||
    (isGlobalSession(s) ? 'Global session' : s.repo_full_name) ||
    'Session';
  const showRepo = showRepoDetails && !hideRepoBadge;
  const activeLabel = formatCompactRelativeTime(s.last_activity_at ?? s.updated_at ?? s.created_at);

  const agentChatUrl = (agentId) => {
    const base = sessionUrl(s.id);
    return `${base}?agent=${agentId}&view=chat`;
  };
  const agentTree = Array.isArray(s.agents) ? s.agents : [];
  // The builder row is always visible; the remaining agents expand by default
  // for the selected session, and on the mobile full-width list also for the
  // last-opened one. The tree's caret overrides this per entry.
  const autoExpanded = isCurrent || (isMobileList && String(s.id) === String(autoExpandId));

  const highlightShellClass = isCurrent ? '-mx-3 mb-1 bg-control-hover px-3 py-2' : '';

  return (
    <div
      data-testid="mini-session-entry"
      data-session-id={s.id}
      data-selected={isCurrent ? 'true' : 'false'}
      className={`group px-3 text-xs transition-colors ${
        isArchived || isArchiving ? 'opacity-50' : ''
      } ${isCurrent ? 'pb-2' : 'py-2 hover:bg-control/50'}`}
    >
      <div data-testid="mini-session-highlight" className={highlightShellClass}>
        <div data-testid="mini-session-title">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              <SessionListIndicator session={s} />
            </span>
            {showOwner && <ListOwnerLabel owner={s.owner} />}
            <Link to={sessionUrl(s.id)} className="flex-1 min-w-0 leading-snug text-left">
              <span className="flex min-w-0 items-center gap-1.5">
                <SessionUnreadDot session={s} suppressUnread={suppressUnreadWhenOpen} />
                <span
                  className={`min-w-0 truncate font-medium ${
                    rowHighlighted ? 'text-fg' : 'text-heading'
                  }`}
                >
                  {title}
                </span>
                {s.loop_id && <SessionLoopIcon />}
                {isReviewInProgress(s) && !isArchiving && <ReviewInProgressBadge compact />}
              </span>
              {showRepo && (
                <span className="block truncate">
                  <CardRepoBadge
                    show
                    isGlobal={isGlobalSession(s)}
                    isSlack={Boolean(s.slack_app_id)}
                    repoFullName={s.repo_full_name}
                  />
                </span>
              )}
            </Link>
            {activeLabel && (
              <span
                className="shrink-0 text-[10px] leading-4 text-faint tabular-nums"
                title="Last activity"
              >
                {activeLabel}
              </span>
            )}
            {isArchiving && (
              <span className="shrink-0 text-[10px] leading-4 text-accent/90">Archiving…</span>
            )}
            {!s.archived_at && !isArchiving && (
              <div className="flex h-4 shrink-0 items-center">
                {isSessionStoppable(s) ? (
                  <StopSession session={s} />
                ) : isOwner ? (
                  <ArchiveSession session={s} onArchive={() => onArchive?.(s)} />
                ) : null}
              </div>
            )}
          </div>
        </div>
        {agentTree.length > 0 && (
          <SessionAgentTree
            agents={agentTree}
            sessionId={s.id}
            pinnedAgentId={s.pinned_agent_id ?? null}
            currentAgentId={routeAgentId}
            canManage={isOwner && !isArchived && !isArchiving}
            onSelectAgent={(agent) => navigate(agentChatUrl(agent.id))}
            onAddBuilder={
              showAddBuilder && onAddBuilder
                ? () => {
                    onAddBuilder(s);
                  }
                : undefined
            }
            showAddBuilder={showAddBuilder && isOwner && !isArchived && !isArchiving}
            autoExpanded={autoExpanded}
            showOwnerGutter={showOwner}
            sessionHighlighted={isCurrent}
          />
        )}
      </div>
    </div>
  );
}

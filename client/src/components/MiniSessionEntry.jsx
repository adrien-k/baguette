import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
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
import TrailingHoverActions from './TrailingHoverActions.jsx';

function sessionRowAction(session, { isOwner, isArchiving, onArchive }) {
  if (session.archived_at || isArchiving) return null;
  if (isSessionStoppable(session)) return <StopSession session={session} />;
  if (!isOwner) return null;
  return <ArchiveSession session={session} overlay onArchive={() => onArchive?.(session)} />;
}

function SessionRowActions({ activeLabel, sessionHighlighted, action }) {
  const label = activeLabel ? (
    <span className="shrink-0 text-[10px] leading-4 text-faint tabular-nums" title="Last activity">
      {activeLabel}
    </span>
  ) : null;
  if (!label && !action) return null;
  return (
    <TrailingHoverActions
      className="shrink-0"
      sessionHighlighted={sessionHighlighted}
      groupName="group"
      hideLabelOnMobile={action != null}
      label={label}
    >
      {action}
    </TrailingHoverActions>
  );
}

function MobileAgentsToggle({ count, expanded, onToggle }) {
  return (
    <button
      type="button"
      data-testid="session-agents-toggle"
      aria-expanded={expanded}
      aria-label={expanded ? 'Hide agents' : 'Show agents'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line/70 bg-control/60 px-1.5 py-0.5 text-[10px] leading-3.5 font-medium text-fg-muted transition-colors hover:bg-control-hover hover:text-fg"
    >
      <span className="tabular-nums">{count}</span>
      <ChevronDown
        className={`h-3 w-3 transition-transform ${expanded ? '' : '-rotate-90'}`}
        aria-hidden
      />
    </button>
  );
}

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
  // Desktop shows the agent tree only on the selected session.
  // Mobile opens a session on tap, so each session row has a toggle (defaulting
  // to expanded for the last-opened session).
  const [mobileManuallyExpanded, setMobileManuallyExpanded] = useState(null);
  const isMobileExpanded = mobileManuallyExpanded ?? String(s.id) === String(autoExpandId);
  const showAgentTree = agentTree.length > 0 && (isMobileList ? isMobileExpanded : isCurrent);

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
                    repoFullName={s.repo_full_name}
                  />
                </span>
              )}
            </Link>
            {isMobileList && agentTree.length > 0 && (
              <MobileAgentsToggle
                count={agentTree.length}
                expanded={isMobileExpanded}
                onToggle={() => setMobileManuallyExpanded(!isMobileExpanded)}
              />
            )}
            {isArchiving && (
              <span className="shrink-0 text-[10px] leading-4 text-accent/90">Archiving…</span>
            )}
            <SessionRowActions
              activeLabel={activeLabel}
              sessionHighlighted={isCurrent}
              action={sessionRowAction(s, { isOwner, isArchiving, onArchive })}
            />
          </div>
        </div>
        {showAgentTree && (
          <SessionAgentTree
            agents={agentTree}
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
            showOwnerGutter={showOwner}
            sessionHighlighted={isCurrent}
          />
        )}
      </div>
    </div>
  );
}

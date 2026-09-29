import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2, Circle, XCircle, Repeat } from 'lucide-react';
import SessionTools, { sessionToolsVisible } from './SessionTools.jsx';
import { formatSessionActiveLabel } from '../utils/dates.js';
import ArchiveSession from './ArchiveSession.jsx';
import StopSession, { isSessionStoppable } from './StopSession.jsx';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import CardRepoBadge from './CardRepoBadge.jsx';
import SessionCardLayout from './SessionCardLayout.jsx';
import SessionListIndicator, { SessionUnreadDot } from './SessionListIndicator.jsx';
import ReviewInProgressBadge, { isReviewInProgress } from './ReviewInProgressBadge.jsx';

export function SessionStatusIcon({ status, compact = false, ...props }) {
  const size = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  switch (status) {
    case 'running':
      return <Loader2 className={`${size} text-success animate-spin shrink-0`} {...props} />;
    case 'provisioning':
      return <Loader2 className={`${size} text-fg-muted animate-spin shrink-0`} {...props} />;
    case 'archiving':
      return <Loader2 className={`${size} text-accent/80 animate-spin shrink-0`} {...props} />;
    case 'approval':
      return <AlertCircle className={`${size} text-accent animate-pulse shrink-0`} {...props} />;
    case 'completed':
      return <CheckCircle2 className={`${size} text-success shrink-0`} {...props} />;
    case 'stopped':
      return <Circle className={`${size} text-faint shrink-0`} {...props} />;
    case 'failed':
    case 'error':
      return <XCircle className={`${size} text-danger shrink-0`} {...props} />;
    default:
      return <Circle className={`${size} text-faint shrink-0`} {...props} />;
  }
}

const STATUS_ACCENT = {
  running: 'border-l-success',
  provisioning: 'border-l-faint',
  archiving: 'border-l-brand/50',
  approval: 'border-l-brand',
  completed: 'border-l-success/40',
  failed: 'border-l-danger',
  error: 'border-l-danger',
};

const BADGE =
  'inline-flex items-center gap-1 shrink-0 rounded border border-strong px-1.5 py-0.5 text-[10px] font-medium text-fg-muted';

export default function SessionCard({ session, suppressRepoBadge = false }) {
  const navigate = useNavigate();
  const { sessionUrl, showRepoDetails } = useFilterRoutes();
  const isArchived = !!session.archived_at;
  const isArchiving = !isArchived && session.status === 'archiving';
  const activeLabel = formatSessionActiveLabel(
    session.last_activity_at ?? session.updated_at ?? session.created_at
  );

  const actions = [];
  if (!isArchived && !isArchiving) {
    if (isSessionStoppable(session)) {
      actions.push({ node: <StopSession session={session} /> });
    } else if (session.status !== 'provisioning') {
      actions.push({ node: <ArchiveSession session={session} /> });
    }
  }

  const titleExtras = (
    <>
      {isArchiving && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-brand/10 text-accent/90 border border-brand/20">
          Archiving…
        </span>
      )}
      {isReviewInProgress(session) && <ReviewInProgressBadge />}
      {session.loop_id && (
        <span title="Started by a loop" className={BADGE}>
          <Repeat className="w-3 h-3 text-accent" />
          Loop
        </span>
      )}
    </>
  );

  return (
    <SessionCardLayout
      onClick={() => navigate(sessionUrl(session.short_id))}
      accentClassName={STATUS_ACCENT[session.status] ?? 'border-l-strong'}
      dimmed={isArchived || isArchiving}
      repo={
        showRepoDetails && !suppressRepoBadge ? (
          <CardRepoBadge
            show
            isGlobal={isGlobalSession(session)}
            repoFullName={session.repo_full_name}
          />
        ) : null
      }
      indicator={<SessionListIndicator session={session} size="md" />}
      title={
        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
          <SessionUnreadDot session={session} />
          <span className="truncate">{session.label || session.repo_full_name}</span>
        </span>
      }
      subtitle={activeLabel || null}
      titleExtras={titleExtras}
      description={
        session.initial_prompt ? (
          <p className="text-xs text-faint line-clamp-2">{session.initial_prompt}</p>
        ) : null
      }
      controls={
        sessionToolsVisible(session, ['pr', 'preview', 'code']) ? (
          <SessionTools
            session={session}
            tools={['pr', 'preview', 'code']}
            size="compact"
            className="flex flex-wrap"
            onToolClick={() => {}}
          />
        ) : null
      }
      actions={actions}
    />
  );
}

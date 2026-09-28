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
import SessionStatusIndicator from './SessionStatusIndicator.jsx';

export function SessionStatusIcon({ status, compact = false, ...props }) {
  const size = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  switch (status) {
    case 'running':
      return <Loader2 className={`${size} text-emerald-400 animate-spin shrink-0`} {...props} />;
    case 'provisioning':
      return <Loader2 className={`${size} text-zinc-400 animate-spin shrink-0`} {...props} />;
    case 'archiving':
      return <Loader2 className={`${size} text-amber-400/80 animate-spin shrink-0`} {...props} />;
    case 'approval':
      return <AlertCircle className={`${size} text-amber-400 animate-pulse shrink-0`} {...props} />;
    case 'completed':
      return <CheckCircle2 className={`${size} text-emerald-400 shrink-0`} {...props} />;
    case 'stopped':
      return <Circle className={`${size} text-zinc-500 shrink-0`} {...props} />;
    case 'failed':
    case 'error':
      return <XCircle className={`${size} text-red-400 shrink-0`} {...props} />;
    default:
      return <Circle className={`${size} text-zinc-600 shrink-0`} {...props} />;
  }
}

const STATUS_ACCENT = {
  running: 'border-l-emerald-500',
  provisioning: 'border-l-zinc-500',
  archiving: 'border-l-amber-500/50',
  approval: 'border-l-amber-500',
  completed: 'border-l-emerald-500/40',
  failed: 'border-l-red-500',
  error: 'border-l-red-500',
};

const BADGE =
  'inline-flex items-center gap-1 shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400';

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
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-400/90 border border-amber-500/20">
          Archiving…
        </span>
      )}
      {session.loop_id && (
        <span title="Started by a loop" className={BADGE}>
          <Repeat className="w-3 h-3 text-amber-400" />
          Loop
        </span>
      )}
    </>
  );

  return (
    <SessionCardLayout
      onClick={() => navigate(sessionUrl(session.short_id))}
      accentClassName={STATUS_ACCENT[session.status] ?? 'border-l-zinc-700'}
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
      indicator={<SessionStatusIndicator session={session} size="md" />}
      title={session.label || session.repo_full_name}
      subtitle={activeLabel || null}
      titleExtras={titleExtras}
      description={
        session.initial_prompt ? (
          <p className="text-xs text-zinc-500 line-clamp-2">{session.initial_prompt}</p>
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

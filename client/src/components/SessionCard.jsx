import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  XCircle,
  Square,
  Archive,
  Repeat,
} from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import SessionTools, { sessionToolsVisible } from './SessionTools.jsx';
import { formatRelativeTime } from '../utils/dates.js';
import ArchiveSession from './ArchiveSession.jsx';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import { useFilterRoutes } from '../hooks/useFilterRoutes.js';
import CardRepoBadge from './CardRepoBadge.jsx';
import CardBranchModel from './CardBranchModel.jsx';

function StatusIcon({ status }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />;
    case 'provisioning':
      return <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin shrink-0" />;
    case 'archiving':
      return <Loader2 className="w-3.5 h-3.5 text-amber-400/80 animate-spin shrink-0" />;
    case 'approval':
      return <AlertCircle className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />;
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'stopped':
      return <Circle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />;
  }
}

const STOPPABLE_STATUSES = new Set(['running']);

const BADGE =
  'inline-flex items-center gap-1 shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400';

export default function SessionCard({ session }) {
  const navigate = useNavigate();
  const { sessionUrl, showRepoDetails } = useFilterRoutes();
  const isArchived = !!session.archived_at;
  const isArchiving = !isArchived && session.status === 'archiving';

  const handleStop = async (e) => {
    e.stopPropagation();
    try {
      await sessionsService.stop(session.id);
    } catch (err) {
      toastError('Failed to stop session', err);
    }
  };

  return (
    <div
      onClick={() => navigate(sessionUrl(session.short_id))}
      className={`w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 sm:p-4 transition-colors border-l-2 cursor-pointer hover:border-zinc-700 active:bg-zinc-800/50 ${
        {
          running: 'border-l-emerald-500',
          provisioning: 'border-l-zinc-500',
          archiving: 'border-l-amber-500/50',
          approval: 'border-l-amber-500',
          completed: 'border-l-emerald-500/40',
          failed: 'border-l-red-500',
          error: 'border-l-red-500',
        }[session.status] ?? 'border-l-zinc-700'
      } ${isArchived || isArchiving ? 'opacity-50' : ''}`}
    >
      {showRepoDetails && (
        <div className="mb-1.5">
          <CardRepoBadge
            show
            isGlobal={isGlobalSession(session)}
            repoFullName={session.repo_full_name}
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 cursor-default">
            {isArchived ? (
              <Archive className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            ) : (
              <StatusIcon status={session.status} />
            )}
          </span>
          <span className="text-white font-medium text-sm truncate">
            {session.label || session.repo_full_name}
          </span>
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
          {session.created_at && (
            <span className="text-zinc-600 text-xs">{formatRelativeTime(session.created_at)}</span>
          )}
          {session.total_cost_usd != null && (
            <span className="text-zinc-600 text-xs">
              {' '}
              · ${parseFloat(session.total_cost_usd).toFixed(3)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isArchived && !isArchiving && STOPPABLE_STATUSES.has(session.status) && (
            <button
              onClick={handleStop}
              title="Stop session"
              className="p-1 text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 rounded transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          {!isArchived && !isArchiving && session.status !== 'provisioning' && (
            <ArchiveSession session={session} />
          )}
        </div>
      </div>
      <CardBranchModel
        isGlobal={isGlobalSession(session)}
        baseBranch={session.base_branch}
        targetBranch={session.created_branch}
        agentSdk={session.agent_sdk}
        model={session.model}
      />
      <p className="text-xs text-zinc-500 line-clamp-2 ml-5">{session.initial_prompt}</p>
      {sessionToolsVisible(session, ['pr', 'preview', 'code']) && (
        <SessionTools
          session={session}
          tools={['pr', 'preview', 'code']}
          size="compact"
          className="mt-1.5 sm:mt-2 ml-5 flex flex-wrap"
          onToolClick={() => {}}
        />
      )}
    </div>
  );
}

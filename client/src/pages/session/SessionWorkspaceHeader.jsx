import { Link } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Repeat, GitBranch, Copy, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { isGlobalSession } from '@baguette/shared/session-scope.js';
import CardRepoBadge from '../../components/CardRepoBadge.jsx';
import LoopLastError from '../../components/LoopLastError.jsx';
import SessionStatusIndicator from '../../components/SessionStatusIndicator.jsx';
import SessionTools from '../../components/SessionTools.jsx';
import { SessionLoopBadge } from '../../components/SessionLoopIndicator.jsx';
import { sessionHeaderTitle } from './sessionListDisplay.js';

const CREATE_WORKSPACE_HEADER_TITLE_CLASS =
  'min-w-0 truncate text-sm font-semibold leading-snug text-fg md:text-base';

export default function SessionWorkspaceHeader({
  isLoopsView,
  routeLoopId,
  loopWorkspace,
  isNewLoopRoute,
  loopsHomeUrl,
  showRepoDetails,
  isNewSessionRoute,
  homeUrl,
  headerSession,
  isMdUp,
  loopEditUrl,
  handlePush,
  pushing,
  commitsToPush,
  session,
  prInfo,
}) {
  return (
    <div className="shrink-0 border-b border-line bg-surface pl-3 pr-3 py-2 md:pl-6">
      {isLoopsView ? (
        isNewLoopRoute ? (
          <div className="flex min-h-11 items-center gap-2 sm:gap-3">
            <Link to={loopsHomeUrl} className="md:hidden shrink-0 text-faint hover:text-secondary">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Repeat className="w-4 h-4 shrink-0 text-accent" aria-hidden />
              <span className={CREATE_WORKSPACE_HEADER_TITLE_CLASS}>New Loop</span>
            </div>
          </div>
        ) : routeLoopId ? (
          <div className="flex items-start justify-between gap-2 min-h-11">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <Link
                to={loopsHomeUrl}
                className="md:hidden shrink-0 text-faint hover:text-secondary mt-0.5"
              >
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-h-6 min-w-0 items-center gap-2">
                  <Repeat className="w-3.5 h-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 truncate text-sm font-medium leading-snug text-fg">
                    {loopWorkspace.headerTitle}
                  </span>
                  {loopWorkspace.headerLoop && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                        loopWorkspace.headerLoop.enabled
                          ? 'border-brand/30 bg-brand/10 text-accent'
                          : 'border-strong text-fg-muted'
                      }`}
                    >
                      {loopWorkspace.headerLoop.enabled ? 'Enabled' : 'Paused'}
                    </span>
                  )}
                  {showRepoDetails && loopWorkspace.headerLoop && (
                    <CardRepoBadge
                      show
                      truncate={false}
                      nowrap
                      className="hidden md:inline-flex"
                      isGlobal={!!loopWorkspace.headerLoop.is_global}
                      repoFullName={loopWorkspace.headerLoop.repo_full_name}
                    />
                  )}
                </div>
                {loopWorkspace.headerSubtitle && (
                  <div className="flex min-w-0 items-center gap-2 text-xs text-faint truncate">
                    {loopWorkspace.headerSubtitle}
                  </div>
                )}
                {loopWorkspace.headerLoop?.last_error && (
                  <LoopLastError message={loopWorkspace.headerLoop.last_error} className="mt-0.5" />
                )}
              </div>
            </div>
            {loopWorkspace.headerLoop && (
              <button
                type="button"
                onClick={() => loopWorkspace.handleDeleteLoop()}
                className="shrink-0 p-1.5 text-faint hover:text-danger transition-colors rounded"
                title="Delete loop"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : null
      ) : isNewSessionRoute ? (
        <div className="flex min-h-11 items-center gap-2 sm:gap-3">
          <Link to={homeUrl} className="md:hidden shrink-0 text-faint hover:text-secondary">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <MessageSquare className="w-4 h-4 shrink-0 text-accent" aria-hidden />
            <span className={CREATE_WORKSPACE_HEADER_TITLE_CLASS}>New Session</span>
          </div>
        </div>
      ) : headerSession ? (
        <div className="flex items-start justify-between gap-2 min-h-11">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Link
              to={homeUrl}
              className="md:hidden shrink-0 text-faint hover:text-secondary mt-0.5"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-h-6 min-w-0 items-center gap-2">
                <SessionStatusIndicator session={headerSession} />
                <span className="min-w-0 truncate text-sm font-medium leading-snug text-fg">
                  {sessionHeaderTitle(headerSession, isMdUp)}
                </span>
                {headerSession.loop_id ? (
                  <SessionLoopBadge to={loopEditUrl(headerSession.loop_id)} />
                ) : null}
                {showRepoDetails ? (
                  <CardRepoBadge
                    show
                    truncate={false}
                    nowrap
                    className="hidden md:inline-flex"
                    isGlobal={isGlobalSession(headerSession)}
                    repoFullName={headerSession.repo_full_name}
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className="hidden sm:inline shrink-0 text-faint">
                  {headerSession.base_branch}
                </span>
                {(headerSession.remote_branch || headerSession.local_branch) && (
                  <span className="flex min-w-0 items-center gap-1 overflow-hidden text-faint">
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      {headerSession.remote_branch || headerSession.local_branch}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          headerSession.remote_branch || headerSession.local_branch
                        );
                        toast.success('Branch name copied');
                      }}
                      className="shrink-0 text-faint hover:text-fg-muted"
                      title="Copy branch name"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>

          <SessionTools
            session={headerSession}
            tools={['pr', 'preview', 'code', 'push']}
            hideLabelBelowSm
            readonly={!!headerSession.archived_at || headerSession.status === 'archiving'}
            onPush={handlePush}
            pushing={pushing}
            commitsToPush={commitsToPush}
            prUrl={session ? prInfo?.url : headerSession.pr_url}
            prNumber={session ? prInfo?.number : headerSession.pr_number}
            showPreviewPublicBadge
          />
        </div>
      ) : null}
    </div>
  );
}
